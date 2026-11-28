package server;

import server.controller.*;
import server.model.*;
import server.model.agents.*;
import server.model.target.AdjustableTarget;
import server.model.target.Target;
import server.model.task.Task;
import tool.GsonUtils;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Array;
import java.util.*;
import java.util.logging.FileHandler;
import java.util.logging.LogManager;
import java.util.logging.Logger;

/**
 * This is the core code for the mainloop and loading of the simulator
 * @author Feng Wu
 */
/* Edited by Yuai */
/* Edited by Will */

public class Simulator {

    private String webRef ="web";

    private final static String SERVER_CONFIG_FILE = "/config/serverConfig.json";
    private final static String SCENARIO_DIR_PATH = "/scenarios/";
    private final Logger LOGGER = Logger.getLogger(Simulator.class.getName());


    private final State state;
    private final Sensor sensor;

    //private final QueueManager queueManager;
    private final AgentController agentController;
    private final TaskController taskController;
    private final TargetController targetController;
    private final ConnectionController connectionController;
    private final ScoreController scoreController;

    private MissionController missionController = null;
    private final HazardController hazardController;
    private final Allocator allocator;
    //private final Modeller modeller;
    private final ModelCaller modelCaller;

    private final ImageController imageController;
    private final ScoutingController scoutingController;
    private final EpisodeController episodeController;
    private final StratTacController stratTacController;
    private volatile String scenarioPage = null;  // Page the launcher opens for this scenario ("page" key); null = sandbox

    public static Simulator instance;

    /** Tick rate the per-tick constants were written for. Per-tick quantities scale by BASE_TICK_RATE / tick rate. */
    public static final double BASE_TICK_RATE = 5;
    public static final double DEFAULT_TICK_RATE = 10;
    public static final double MIN_TICK_RATE = 2, MAX_TICK_RATE = 30;
    public static final double MIN_SIM_SPEED = 0.25, MAX_SIM_SPEED = 8;
    public static final double DEFAULT_SIM_SPEED = 0.5;  // Starting speed for a scenario without "simSpeed"
    private volatile double highTickRate = DEFAULT_TICK_RATE;  // Sim updates per simulated second
    private static final double lowTickRate = 1;  // Certain functions can be checked less often (once per second)
    private volatile double simSpeed = DEFAULT_SIM_SPEED;  // Simulated seconds per real second
    private final Random random;

    private Thread mainLoopThread;
    private String lastTickError;   // Last tick exception logged, so a repeating one is logged once
    private int completedTargets = 0;

    // Predictive formal modelling (PFM) delivery missions, ported from dev_verification
    private int port;
    private double lastRemovalTime = -1;   // sim time (s) of the last agent removal at the hub
    private double lastBat = 1;            // battery of the last agent removed
    private int scoreLogCounter = 0;
    private boolean pfmStarted = false;
    private java.util.logging.Handler loggingFileHandler;
    private String currentLogFile = null;   // File the current participant's log is written to (set by resetLogging)
    private static final int SCORE_LOG_EVERY_SECONDS = 10;
    private static final double PFM_HUB_RECHARGE_PER_SECOND = 0.0625;  // 0.0025 per study-era tick x 25 ticks/s
    private static final double PFM_PLACEHOLDER_ESTIMATE = 540;        // the study's 09:00 placeholder until the first result

    public Simulator() {
        instance = this;
        state = new State();
        sensor = new Sensor(this);
        connectionController = new ConnectionController(this);
        allocator = new Allocator(this);
        //queueManager = new QueueManager(this);
        agentController = new AgentController(this, sensor);
        taskController = new TaskController(this);
        hazardController = new HazardController(this);
        targetController = new TargetController(this);
        scoreController = new ScoreController(this);
        //modeller = new Modeller(this);
        modelCaller = new ModelCaller();
        random = new Random();

        imageController = new ImageController(this);
        scoutingController = new ScoutingController(this);
        episodeController = new EpisodeController(this);
        stratTacController = new StratTacController(this);

        //queueManager.initDroneDataConsumer();
    }

    public static void main(String[] args) {
        try {
            LogManager.getLogManager().readConfiguration(new FileInputStream("./loggingForStudy.properties"));
        } catch (final IOException e) {
            Logger.getAnonymousLogger().severe("Could not load default loggingForStudy.properties file");
            Logger.getAnonymousLogger().severe(e.getMessage());
        }

        //Setup GSON
        GsonUtils.registerTypeAdapter(Task.class, Task.taskSerializer);
        GsonUtils.registerTypeAdapter(State.HazardHitCollection.class, State.hazardHitsSerializer);
        GsonUtils.create();

        int port;
        if (args.length > 0) {
            port = Integer.parseInt(args[0]);
        } else {
            port = 44101;
        }
        new Simulator().start(port);
    }

    public void start(Integer port) {
        //Setup GSON
        GsonUtils.registerTypeAdapter(Task.class, Task.taskSerializer);
        GsonUtils.registerTypeAdapter(State.HazardHitCollection.class, State.hazardHitsSerializer);
        GsonUtils.create();

        pushConfig(port);
        new Thread(connectionController::start).start();
        LOGGER.info(String.format("%s; SVRDY; Server ready ", getState().getTime()));
    }

    public void startSandboxMode() {
        this.state.setGameType(State.GAME_TYPE_SANDBOX);
        this.state.setGameId("Sandbox");
        LOGGER.info(String.format("%s; SBXLD; Sandbox loaded ", getState().getTime()));
        this.startSimulation();
    }

    public boolean loadScenarioMode(String scenarioFileName) {
        this.state.setGameType(State.GAME_TYPE_SCENARIO);
        if(loadScenarioFromFile(webRef+"/scenarios/" + scenarioFileName)) {
            LOGGER.info(String.format("%s; SCLD; Scenario loaded (filename); %s ", getState().getTime(), scenarioFileName));
            return true;
        } else {
            LOGGER.info(String.format("%s; SCUN; Unable to start scenario (filename); %s ", getState().getTime(), scenarioFileName));
            return false;
        }
    }

    public void startSimulation() {
        //state.setScenarioEndTime();
        //Heart beat all virtual agents to prevent time out when user is reading the description.
        for(Agent agent : this.state.getAgents())
            if(agent.isSimulated())
                agent.heartbeat();
        this.agentController.stopAllAgents();
        episodeController.start();
        this.mainLoopThread = new Thread(this::mainLoop);
        mainLoopThread.start();
        this.state.setInProgress(true);
        LOGGER.info(String.format("%s; SIMST; Simulation started", getState().getTime()));
    }

    public Map<String, String> getScenarioFileListWithGameIds() {
        Map<String, String> scenarios = new HashMap<>();
        File scenarioDir = new File(webRef+SCENARIO_DIR_PATH);
        if(scenarioDir.exists() && scenarioDir.isDirectory()) {
            for(File file : scenarioDir.listFiles()) {
                if (!file.isDirectory()) {
                    String scenarioName = getScenarioNameFromFile(webRef + SCENARIO_DIR_PATH + file.getName());
                    if (scenarioName != null)
                        scenarios.put(file.getName(), scenarioName);
                }
            }
        }
        else
            LOGGER.info(String.format("%s; SCNF; Could not find scenario (directory); %s ", getState().getTime(), SCENARIO_DIR_PATH));
        return scenarios;
    }

    private void mainLoop() {
        int lowTickCounter = 0;  // Slightly clumsy, but a quick way to only check every 5th step for an addition
        int sleepTime;
        do {
            long startTime = System.currentTimeMillis();
            // Read once per tick so the live sliders can change these between ticks
            final double tickRate = highTickRate;
            final double waitTime = 1000.0 / (tickRate * simSpeed);
            state.incrementTime(1 / tickRate);
            // An exception in one tick is logged and the loop carries on, so a single bad agent or task cannot freeze
            // the simulation (the main loop thread used to die and the map stopped updating)
            try {
            // Degradation study: the episode sequence decides when the run ends
            if (episodeController.isEnabled() && episodeController.step()) {
                System.out.println("DONE BY EPISODES: " + state.getTime());
                processStudyLog();
                this.reset(false);
                break;
            }
            //if (state.getScenarioEndTime() !=0 && System.currentTimeMillis() >= state.getScenarioEndTime()) {
            if (state.getTimeLimit() != 0 && state.getTime() >= state.getTimeLimit()) {
                System.out.println("DONE BY TIME: " + state.getTime());
                if (state.isPfmMission()) {
                    logScoreTick();
                    LOGGER.info(String.format("%s; TMCMP; Time completion - scenario completed by time with tasks completed (numComplete); %s ", getState().getTime(), getState().getCompletedTasks().size()));
                }
                /*
                System.out.println("agents = " + state.getAgents());
                int numFailed = 0;
                for (Agent a : state.getAgents()) {
                    if (a instanceof AgentVirtual av) {
                        if (!av.isAlive()) {
                            numFailed++;
                        }
                    }
                }
                System.out.println("Num failed: " + numFailed);
                modeller.outputResults();
                 */
                //state.setInProgress(false);
                if (state.hasPassthrough()) {
                    updateNextValues();
                }
                //this.reset();
                scoutingController.finish();
                this.reset(false);

                break;
                //passthrough();


            }

            // Decide if we should spawn a new task
            lowTickCounter++;
            if (lowTickCounter >= Math.round(lowTickRate * tickRate)) {
                if (missionController != null) {
                    missionController.spawnIfRequired(state.getTime());
                }
                if (state.isPfmMission()) {
                    pfmEverySecond();
                }
                lowTickCounter = 0;
            }



            // PFM missions keep the study engine's 5 s settling delay before agents start
            if (!state.isPfmMission() || state.getTime() > 5) {

                if (state.getAllocationStyle().equals("dynamic")) {
                    if (state.getTasks().size() == 0) {// && getState().getHub() instanceof AgentHub && ((AgentHub) getState().getHub()).allAgentsNear()) {
                        System.out.println("DONE BY COMPLETION: " + state.getTime());
                        if (state.isPfmMission()) {
                            logScoreTick();
                            LOGGER.info(String.format("%s; FLCMP; Full completion - scenario completed all tasks with most recent prediction in time (pred); %s ", getState().getTime(), state.getEstimatedCompletionTime()));
                        }
                        System.out.println("agents = " + state.getAgents());
                        int numFailed = 0;
                        for (Agent a : state.getAgents()) {
                            if (a instanceof AgentVirtual av) {
                                if (!av.isAlive()) {
                                    numFailed++;
                                }
                            }
                        }
                        System.out.println("Num failed: " + numFailed);
                        scoutingController.finish();
                        this.reset();
                    }

                    List<Agent> agentsToRemove = new ArrayList<>();
                    if (state.isPfmMission()) {
                        stepPfmAgents(agentsToRemove);
                    } else {
                        synchronized (state.getAgents()) {
                            for (Agent agent : state.getAgents()) {
                                if (agent instanceof AgentVirtual av) {
                                    if (agentController.modelFailure(av)) {
                                        //modeller.failRecord(agent.getId(), agent.getAllocatedTaskId());
                                    }

                                    if (agent.isTimedOut()) {
                                        //System.out.println("timed out, passing");
                                    } else if (!av.isAlive() && (!av.isGoingHome() || av.isHome())) {
                                        av.charge();
                                    } else if (agent.getBattery() < 0.15 && av.isAlive()) {
                                        //modeller.failRecord(agent.getId(), agent.getAllocatedTaskId());
                                        av.killBattery();
                                    } else if (av.getTask() != null || (av.isGoingHome() && !av.isHome())) {
                                        //System.out.println(agent);
                                        av.step(state.isFlockingEnabled());
                                    } else {
                                        if (getAgentController().getScheduledRemovals() > 0) {
                                            agentsToRemove.add(agent);
                                            getAgentController().decrementRemoval();
                                        } else if (scoutingController.isEnabled() && !state.getTasks().isEmpty()) {
                                            // Scouting (AAMAS demo): a free agent takes the nearest unclaimed target, or
                                            // doubles up on the nearest one when all are claimed (saturating re-allocation).
                                            // Busy agents keep their task, so nobody is pulled off mid-flight.
                                            av.stopGoingHome();
                                            if (!getAllocator().dynamicAssignNearest(av, false)) {
                                                getAllocator().dynamicAssignNearest(av, true);
                                            }
                                        } else if (getTaskController().checkForFreeTasks()) {
                                            av.stopGoingHome();
                                            getAllocator().dynamicAssign(av);
                                            if (av.getAllocatedTaskId() != null && av.getTask().getType() == 6) {
                                                av.setType("withpack");
                                                av.setMarker("UAVWithPack");
                                            }
                                            Simulator.instance.getScoreController().incrementCompletedTask();
                                            // In-runtime allocation model
                                            //double successChance = modeller.calculateAll(agent);
                                            //state.setSuccessChance(successChance);
                                        } else if (agent.getBattery() < 0.9 && av.isAlive()) {
                                            // If no tasks available, charge up in case we need to replace it
                                            av.charge();
                                        } else {
                                            av.heartbeat();
                                        }
                                    }
                                }
                            }
                        }

                    }

                    agentsToRemove.forEach(a -> {
                        getState().getAgents().remove(a);

                        // If an agent is removed or dies, update model and start thread
                        //updateMissionModel();
                    });

                } else {
                    checkAgentsForTimeout();

                    Hub hub = state.getHub();
                    if (hub instanceof AgentHub ah) {
                        ah.step(state.isFlockingEnabled());
                    } else if (hub instanceof AgentHubProgrammed ahp) {
                        ahp.step(state.isFlockingEnabled());
                    }
                    // ELSE no hub
                    state.getAgents().forEach(a -> a.step(state.isFlockingEnabled()));
                }

                if (state.isCommunicationConstrained()) {
                    state.updateAgentVisibility();
                    state.updateGhosts();
                    state.moveGhosts();
                }

                // Step tasks - requires completed tasks array to avoid concurrent modification.
                List<Task> completedTasks = new ArrayList<>();
                synchronized (state.getTasks()) {
                    for (Task task : state.getTasks()) {
                        if (task.step()) {
                            // If it's already tagged by a programmed agent, or if it gets completed by the step command
                            completedTasks.add(task);
                            //System.out.println("Adding " + task.getId());
                        }
                    }
                }

                if (state.isPfmMission()) {
                    completePfmTasks(completedTasks);
                } else {
                    synchronized (Simulator.instance.getState().getCompletedTasks()) {
                        completedTasks.stream().filter(task -> task.getType() == 6).forEach(task -> task.getAgents().forEach(a -> a.setType("standard")));
                        //if (!completedTasks.isEmpty()) {
                            //completedTasks.forEach(t -> modeller.passRecords(t.getId()));
                            completedTasks.forEach(Task::complete);
                        //}
                    }
                }

                //if (!modeller.isStarted()) {
                //    modeller.start();
                //    updateMissionModel();
                //}

            }

            //scoreController.handleUpkeep();

            // Step hazard hits
            //this.state.decayHazardHits();

            // Check and trigger images that are scheduled
            // The review panel is on through the uIOptions entry or, in older study files such as the resolution study,
            // through the top-level "reviewPanel": true
            if (state.UIOptionIsAvailable("reviewPanel") || state.isShowReviewPanel()) {
                imageController.checkForImages();
            }
            scoutingController.step();
            // Strategic/tactical study: its own engine advances by the same simulated step
            if (stratTacController.isEnabled())
                stratTacController.step(1 / tickRate);
            } catch (RuntimeException e) {
                String msg = String.valueOf(e);
                if (!msg.equals(lastTickError)) {
                    LOGGER.log(java.util.logging.Level.SEVERE, "Simulation tick failed; carrying on", e);
                    lastTickError = msg;
                }
            }

            long endTime = System.currentTimeMillis();
            sleepTime = (int) (waitTime - (endTime - startTime));
            if (sleepTime < 0) {
                sleepTime = 0;
            }
        } while (sleep(sleepTime));
    }

    /**
     * Runs the PRISM model (current, one agent fewer, one agent more) for the current state.
     * Does nothing unless the scenario's verificationParameters enable it (checked in ModelCaller).
     */
    public void updateMissionModel() {
        updateMissionModel(0);
    }

    /**
     * As {@link #updateMissionModel()}, discounting agents already scheduled for removal (min 4 agents).
     */
    public void updateMissionModel(int numRemovals) {
        ArrayList<double[][]> generatedCurrent = ModelGenerator.run(state, webRef);
        while (numRemovals > 0 && generatedCurrent.get(0).length - numRemovals > 4) { // TODO make max removals (4) not hard coded
            generatedCurrent.set(0, Arrays.copyOf(generatedCurrent.get(0), generatedCurrent.get(0).length - 1));
            numRemovals--;
        }
        ArrayList<double[][]> generatedOver = ModelGenerator.runOver(generatedCurrent);
        ArrayList<double[][]> generatedUnder = ModelGenerator.runUnder(generatedCurrent);
        ArrayList<ArrayList<double[][]>> config = new ArrayList<>(3);
        config.add(generatedUnder);
        config.add(generatedCurrent);
        config.add(generatedOver);
        modelCaller.startThread(webRef, config);
    }

    // ---------------------------------------------------------------------------------------------
    // PFM delivery missions. These rules are the dev_verification engine's, used in the PFM studies
    // (Abioye et al. HRI 2024, THRI 2025). Times are converted from study-era sim time (5x real time)
    // to the current clock (real seconds).
    // ---------------------------------------------------------------------------------------------

    /** Agent rules for PFM delivery missions: charging, battery death, hub removals and reassignment. */
    private void stepPfmAgents(List<Agent> agentsToRemove) {
        synchronized (state.getAgents()) {
            for (Agent agent : state.getAgents()) {
                if (!(agent instanceof AgentVirtual av)) continue;
                if (agent.isTimedOut()) {
                    // pass
                } else if (!av.isAlive() && (!av.isGoingHome() || av.isHome()) && state.getScheduledRemovals() == 0) {
                    av.charge();
                } else if (agent.getBattery() < 0.15 && av.isAlive()) {
                    LOGGER.info(String.format("%s; BTKIL; Agent battery dead - going home (agentId); %s;", state.getTime(), av.getId()));
                    av.killBattery();
                } else if (av.getTask() != null || (av.isGoingHome() && !av.isHome())) {
                    av.step(state.isFlockingEnabled());
                } else if (state.getScheduledRemovals() > 0) {
                    LOGGER.info(String.format("%s; REMAG; Successfully removed agent - now there are (agentId, numAgents); %s; %s ", state.getTime(), av.getId(), state.getAgents().size() - 1));
                    agentsToRemove.add(agent);
                    lastRemovalTime = state.getTime();
                    lastBat = agent.getBattery();
                    state.decrementRemovals();
                } else if (getTaskController().checkForFreeTasks()) {
                    av.stopGoingHome();
                    if (av.getBattery() > 0.3) {
                        getAllocator().dynamicAssign(av, false);
                        if (av.getTask() != null) {
                            LOGGER.info(String.format("%s; ASGN; Agent assigned to task (agentId, taskId); %s; %s ", state.getTime(), av.getId(), av.getTask().getId()));
                        }
                    } else {
                        av.killBattery();
                    }
                } else if (agent.getBattery() < 0.5 && av.isAlive()) {
                    // No free tasks: charge up in case this agent is needed as a replacement
                    av.charge();
                } else {
                    // Full battery and no free task: back up an existing task
                    getAllocator().dynamicAssign(agent, true);
                }
            }
        }
    }

    private void completePfmTasks(List<Task> completedTasks) {
        for (Task task : completedTasks) {
            LOGGER.info(String.format("%s; TSKCM; Task completed by agent - there are now tasks left (taskId, agentId numTasks); %s; %s; %s ", state.getTime(), task.getId(), task.getAgents().get(0).getId(), state.getTasks().size() - 1));
            task.getAgents().forEach(a -> a.setType("standard"));
            task.complete();
            scoreController.incrementCompletedTask();
        }
    }

    /** Called once per simulated second during PFM missions: placeholder estimate, upkeep, score log, autorun. */
    private void pfmEverySecond() {
        if (!pfmStarted && state.getTime() > 5) {
            pfmStarted = true;
            state.setEstimatedCompletionTime(PFM_PLACEHOLDER_ESTIMATE);
            state.setEstimatedCompletionUnderTime(PFM_PLACEHOLDER_ESTIMATE);
            state.setEstimatedCompletionOverTime(PFM_PLACEHOLDER_ESTIMATE);
        }
        scoreController.handleUpkeep();
        if (++scoreLogCounter >= SCORE_LOG_EVERY_SECONDS) {
            logScoreTick();
            scoreLogCounter = 0;
        }
        if (modelCaller.getAutoRunFrequency() != 0 && state.getTime() > modelCaller.getNextAutoRun()) {
            LOGGER.info(String.format("%s; AUTRN; Autorun of model;", state.getTime()));
            updateMissionModel();
            modelCaller.setNextAutoRun(state.getTime() + modelCaller.getAutoRunFrequency());
        }
    }

    private void logScoreTick() {
        LOGGER.info(String.format("%s; SCORE; Score tick - (numAgents, completedTasks, score, missionCost, previous_mission_cost); %s; %s; %s; %s; %s ",
                state.getTime(), state.getAgents().size() - 1, scoreController.getCompletedTasks(), scoreController.getScore(),
                scoreController.getMission_cost(), scoreController.getPrevious_mission_cost()));
    }

    /** Battery for an agent re-added at the hub: the last removed agent's battery, recharged for the time since. */
    public double pfmBatteryForReaddedAgent() {
        double secondsSinceRemoval = lastRemovalTime < 0 ? 1000 : state.getTime() - lastRemovalTime;
        double bat = Math.min(lastBat + secondsSinceRemoval * PFM_HUB_RECHARGE_PER_SECOND, 1.0);
        lastRemovalTime = -1;
        lastBat = 1;
        return bat;
    }

    public int getPort() {
        return port;
    }

    /** The current study log file handler, or null before a participant is registered. */
    public java.util.logging.Handler getLoggingFileHandler() {
        return loggingFileHandler;
    }

    private void passthrough() {
        state.reset();
        agentController.resetAgentNumbers();
        hazardController.resetHazardNumbers();
        targetController.resetTargetNumbers();
        taskController.resetTaskNumbers();
        scoreController.reset();
        modelCaller.reset();
        //modeller.stop();  // NOTE, if we disable the normal modeller, we will need to slightly refactor to give the modelCaller this start/stop functionality

        LOGGER.info(String.format("%s; SVRST; Server temporarily reset ", getState().getTime()));
        imageController.reset();
        scoutingController.reset();
        episodeController.reset();
        stratTacController.reset();
        scenarioPage = null;

        loadScenarioFromFile("web/scenarios/" + state.getNextFileName());

        //startSimulation();
    }

    private void updateNextValues() {
        try {
            String json = GsonUtils.readFile("web/scenarios/" + getState().getNextFileName());
            Object obj = GsonUtils.fromJson(json);
            state.setGameId(GsonUtils.getValue(obj, "gameId"));
            state.setGameDescription(GsonUtils.getValue(obj, "gameDescription"));
            LOGGER.info(String.format("%s; SCPS; Passing through to next scenario ", getState().getTime()));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    /**
     * Check if any agents have timed out or reconnected this step.
     */
    private void checkAgentsForTimeout() {
        for (Agent agent : state.getAgents()) {
            //Check if agent is timed out
            if (agent.getMillisSinceLastHeartbeat() > 20 * 1000) {
                if(!agent.isTimedOut()) {
                    agent.setTimedOut(true);
                    LOGGER.info(String.format("%s; LSTCN; Lost connection with agent (id); %s ", getState().getTime(), agent.getId()));
                }
            }
        }
    }

    public void changeView(int modeFlag) {
        //System.out.println("TEMP FORCECHANGE: mode forced to task edit");
        //modeFlag = 2;
        LOGGER.info(String.format("%s; CHVW; Changing view to mode; %s ", Simulator.instance.getState().getTime(), modeFlag));
        if (modeFlag == 2) {
            //agentController.stopAllAgents();
            //agentController.updateAgentsTempRoutes();
            //allocator.copyRealAllocToTempAlloc();
            //allocator.clearAllocationHistory();
            state.setEditMode(2);
        } else if (modeFlag == 1){
            //allocator.confirmAllocation(state.getAllocation());
            state.setEditMode(1);
        } else if (modeFlag == 3) {
            state.setEditMode(3);
            //Clear agents and tasks
            /*
            for(Agent agent : state.getAgents()) {
                agent.resume();
            }

             */
        }
    }

    public void setProvDoc(String docid) {
        state.setProvDoc(docid);
    }

    public synchronized void reset() {
        reset(true);
    }

    public synchronized void reset(boolean interruptMain) {
        if (interruptMain && this.mainLoopThread != null) {
            this.mainLoopThread.interrupt();
         }
        state.reset();
        agentController.resetAgentNumbers();
        hazardController.resetHazardNumbers();
        targetController.resetTargetNumbers();
        taskController.resetTaskNumbers();
        scoreController.reset();
        modelCaller.reset();
        if (missionController != null) {
            missionController.reset();
        }
        allocator.clearTeamAllocationUndo();
        pfmStarted = false;
        scoreLogCounter = 0;
        lastRemovalTime = -1;
        lastBat = 1;
        //modeller.stop();  // NOTE, if we disable the normal modeller, we will need to slightly refactor to give the modelCaller this start/stop functionality

        LOGGER.info(String.format("%s; SVRST; Server reset ", getState().getTime()));
        imageController.reset();
        scoutingController.reset();
        episodeController.reset();
        stratTacController.reset();
        scenarioPage = null;
    }

    public void resetLogging(String userName) {
        try {
            String fileName = userName + "-" + state.getGameId() + ".log";
            FileHandler fileHandler = new FileHandler(fileName);
            LogManager.getLogManager().reset();
            LogManager.getLogManager().readConfiguration(new FileInputStream("./loggingForStudy.properties"));
            LOGGER.addHandler(fileHandler);
            state.resetLogger(fileHandler);
            taskController.resetLogger(fileHandler);
            //queueManager.resetLogger(fileHandler);
            agentController.resetLogger(fileHandler);
            targetController.resetLogger(fileHandler);
            connectionController.resetLogger(fileHandler);
            hazardController.resetLogger(fileHandler);
            allocator.resetLogger(fileHandler);
            imageController.resetLogger(fileHandler);
            modelCaller.resetLogger(fileHandler);
            scoutingController.resetLogger(fileHandler);
            episodeController.resetLogger(fileHandler);
            stratTacController.resetLogger(fileHandler);
            currentLogFile = fileName;
            this.loggingFileHandler = fileHandler;
            LOGGER.info(String.format("%s; LGSTRT; Reset log (scenario, username); %s; %s ", getState().getTime(), state.getGameId(), userName));

        } catch (final IOException e) {
            Logger.getAnonymousLogger().severe("Could not load default loggingForStudy.properties file");
            Logger.getAnonymousLogger().severe(e.getMessage());
        }

        //System.out.println("Save now as " + userName + ", " + state.getGameId());
    }

    private void readConfig() {
        try {
            LOGGER.info(String.format("%s; RDCFG; Reading Server Config File (directory); %s ", getState().getTime(), webRef+SERVER_CONFIG_FILE));
            String json = GsonUtils.readFile(webRef+SERVER_CONFIG_FILE);
            Object obj = GsonUtils.fromJson(json);
            Double port = GsonUtils.getValue(obj, "port");

            connectionController.init((port != null) ? port.intValue() : 8080, webRef);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private void pushConfig(int port) {
        this.port = port;
        connectionController.init(port);
    }

    /**
     * Fixed agent teams for the team heatmap modes (from exp_fastpi): take the first ungrouped agent and its
     * teamSize-1 nearest ungrouped agents, repeat until every agent is in a team.
     */
    private void formAgentTeams(int teamSize) {
        List<Agent> ungrouped = new ArrayList<>(state.getAgents());
        while (!ungrouped.isEmpty()) {
            Agent first = ungrouped.remove(0);
            List<Agent> team = new ArrayList<>(ungrouped.stream()
                    .sorted(Comparator.comparingDouble(a -> first.getCoordinate().getDistance(a.getCoordinate())))
                    .limit(teamSize - 1)
                    .toList());
            team.add(first);
            ungrouped.removeAll(team);
            List<String> ids = team.stream().map(Agent::getId).toList();
            for (Agent a : team) a.setAgentTeam(new ArrayList<>(ids));
            LOGGER.info(String.format("%s; TEAM; Formed agent team (ids); %s", state.getTime(), String.join(",", ids)));
        }
    }

    private boolean loadScenarioFromFile(String scenarioFile) {
        try {
            String json = GsonUtils.readFile(scenarioFile);
            Object obj = GsonUtils.fromJson(json);

            this.state.setGameId(GsonUtils.getValue(obj, "gameId"));
            this.state.setLastScoutResult(null);

            // PFM delivery missions: must be read before agents are created (legacy physics sets their speed)
            Object verificationJson = GsonUtils.getValue(obj, "verificationParameters");
            if (verificationJson != null) {
                state.setPfmMission(true);
                // The PFM study ran entirely in the monitor view (its mode toggles were hidden)
                state.setEditMode(1);
                Object legacy = GsonUtils.getValue(obj, "legacyStudyPhysics");
                state.setLegacyStudyPhysics(!(legacy instanceof Boolean b) || b);  // default on for PFM scenarios
                Object isEnabled = GsonUtils.getValue(verificationJson, "isEnabled");
                if (isEnabled instanceof Boolean b) modelCaller.setEnabled(b);
                Object isDummy = GsonUtils.getValue(verificationJson, "isDummy");
                if (isDummy instanceof Boolean b) modelCaller.setDummy(b);
                if (GsonUtils.getValue(verificationJson, "samples") != null)
                    modelCaller.setSamples(((Double) GsonUtils.getValue(verificationJson, "samples")).intValue());
                if (GsonUtils.getValue(verificationJson, "delayTime") != null)
                    modelCaller.setDelayTime(((Double) GsonUtils.getValue(verificationJson, "delayTime")).intValue());
                if (GsonUtils.getValue(verificationJson, "delayBound") != null)
                    modelCaller.setDelayBound(((Double) GsonUtils.getValue(verificationJson, "delayBound")).intValue());
                if (GsonUtils.getValue(verificationJson, "autoRunFrequency") != null)
                    modelCaller.setAutorunFrequency(((Double) GsonUtils.getValue(verificationJson, "autoRunFrequency")).intValue());
            } else if (GsonUtils.getValue(obj, "legacyStudyPhysics") instanceof Boolean b) {
                state.setLegacyStudyPhysics(b);
            }
            this.state.setGameDescription(GsonUtils.getValue(obj, "gameDescription"));
            Object centre = GsonUtils.getValue(obj, "gameCentre");
            this.state.setGameCentre(new Coordinate(GsonUtils.getValue(centre, "lat"), GsonUtils.getValue(centre, "lng")));

            // Heatmap allocation interface: "dynamic" (original, the default), "teams" (exp_fastpi) or "lens"
            Object heatmapUI = GsonUtils.getValue(obj, "heatmapUI");
            if (heatmapUI instanceof String h && Arrays.asList("dynamic", "teams", "lens").contains(h)) {
                state.setHeatmapUI(h);
            } else if (heatmapUI != null) {
                LOGGER.warning("Unknown heatmapUI '" + heatmapUI + "' in scenario file; using 'dynamic'.");
            }

            Object dynamicUIFeaturesJson = GsonUtils.getValue(obj, "dynamicUIFeatures");
            if (dynamicUIFeaturesJson != null) {
                List<List<String>> featureList = new ArrayList<>(5);
                featureList.add(GsonUtils.getValue(dynamicUIFeaturesJson, "1"));
                featureList.add(GsonUtils.getValue(dynamicUIFeaturesJson, "2"));
                featureList.add(GsonUtils.getValue(dynamicUIFeaturesJson, "3"));
                featureList.add(GsonUtils.getValue(dynamicUIFeaturesJson, "4"));
                featureList.add(GsonUtils.getValue(dynamicUIFeaturesJson, "5"));
                this.state.setDynamicUIFeatures(featureList);
            }

            if(GsonUtils.hasKey(obj,"allocationMethod")) {
                String allocationMethod = GsonUtils.getValue(obj, "allocationMethod")
                        .toString()
                        .toLowerCase();

                List<String> possibleMethods = new ArrayList<>(Arrays.asList(
                        "random",
                        "maxsum",
                        "maxsumsaturated",
                        "maxsumwithoverspill",
                        "bestfirst",
                        "basicbundle",
                        "heuristicbundle",
                        "cbaa",
                        "cbba",
                        "cbbacoverage"
                ));

                if(possibleMethods.contains(allocationMethod)) {
                    this.state.setAllocationMethod(allocationMethod);
                } else {
                    LOGGER.warning("Allocation method: '" + allocationMethod + "' not valid. Set to 'maxsum'.");
                    // state.allocationMethod initialised with default value of 'maxsum'
                }
            }

            if(GsonUtils.hasKey(obj,"allocationStyle")) {
                String allocationStyle = GsonUtils.getValue(obj, "allocationStyle")
                        .toString()
                        .toLowerCase();

                List<String> possibleMethods = new ArrayList<>(Arrays.asList(
                        "manual",
                        "manualwithstop",
                        "dynamic",
                        "bundle"
                ));

                if(possibleMethods.contains(allocationStyle)) {
                    this.state.setAllocationStyle(allocationStyle);
                } else {
                    LOGGER.warning("Allocation style: '" + allocationStyle + "' not valid. Set to 'manualwithstop'.");
                    // state.allocationMethod initialised with default value of 'maxsum'
                }
            }

            if (GsonUtils.hasKey(obj, "taskGroupSize")) {
                Object taskGroupSize = GsonUtils.getValue(obj, "taskGroupSize");
                this.state.setTaskGroupSize(((Double) taskGroupSize).intValue());
            }

            if (GsonUtils.hasKey(obj, "regionCoverage")) {
                this.state.setRegionCoverage(Boolean.TRUE.equals(GsonUtils.getValue(obj, "regionCoverage")));
            }

            // Swarm degradation study (exp_degradation_coloured)
            if (GsonUtils.hasKey(obj, "complexFlocking"))
                this.state.setComplexFlocking(Boolean.TRUE.equals(GsonUtils.getValue(obj, "complexFlocking")));
            if (GsonUtils.getValue(obj, "motionScale") instanceof Double ms && ms > 0)
                this.state.setMotionScale(ms);
            if (obj instanceof Map<?, ?> scenarioMap && scenarioMap.get("episodes") != null)
                episodeController.configure((Map<String, Object>) scenarioMap);
            // Strategic/tactical study (StratTac): the engine and the interface configurator read the whole scenario
            if (obj instanceof Map<?, ?> scenarioMap && scenarioMap.get("strattac") != null)
                stratTacController.configure((Map<String, Object>) scenarioMap);
            if (GsonUtils.getValue(obj, "page") instanceof String page && !page.isBlank())
                scenarioPage = page;

            if(GsonUtils.hasKey(obj,"flockingEnabled")){
                Object flockingEnabled = GsonUtils.getValue(obj, "flockingEnabled");
                if(flockingEnabled.getClass() == Boolean.class) {
                    this.state.setFlockingEnabled((Boolean)flockingEnabled);
                } else {
                    LOGGER.warning("Expected boolean value for flockingEnabled in scenario file. Received: '" +
                            flockingEnabled + "'. Set to false.");
                    // state.flockingEnabled initialised with default value of false
                }
            }

            if(GsonUtils.hasKey(obj,"loggingById")){
                Object loggingById = GsonUtils.getValue(obj, "loggingById");
                if(loggingById.getClass() == Boolean.class) {
                    this.state.setLoggingById((Boolean) loggingById);
                } else {
                    LOGGER.warning("Expected boolean value for loggingById in scenario file. Received: '" +
                            loggingById + "'. Set to false.");
                    // state.flockingEnabled initialised with default value of false
                }
            }

            this.state.resetNext();
            // Each scenario starts at half speed (x1 felt too fast for demos) unless it sets "simSpeed"; the study
            // scenarios set 1.0 so they run in real time as they did in the studies. A scenario may also ask for its
            // own tick rate (e.g. 5 for the classic feel)
            Double scenarioTickRate = null;
            if (GsonUtils.hasKey(obj, "tickRate") && GsonUtils.getValue(obj, "tickRate") instanceof Double d)
                scenarioTickRate = d;
            double scenarioSpeed = DEFAULT_SIM_SPEED;
            if (GsonUtils.hasKey(obj, "simSpeed") && GsonUtils.getValue(obj, "simSpeed") instanceof Double d)
                scenarioSpeed = d;
            setTiming(scenarioSpeed, scenarioTickRate);
            if(GsonUtils.hasKey(obj,"timeLimitSeconds")){
                Object timeLimitSeconds = GsonUtils.getValue(obj, "timeLimitSeconds");
                if(timeLimitSeconds.getClass() == Double.class) {
                    //state.incrementTimeLimit((Double)timeLimitSeconds);
                    state.setSimTimeLimit(((Double) timeLimitSeconds).intValue());
                } else {
                    LOGGER.warning("Expected double value for timeLimitSeconds in scenario file. Received: '" +
                            timeLimitSeconds + "'. Time limit not changed.");
                }
            }
            if(GsonUtils.hasKey(obj,"timeLimitMinutes")){
                Object timeLimitMinutes = GsonUtils.getValue(obj, "timeLimitMinutes");
                if(timeLimitMinutes.getClass() == Double.class) {
                    //state.incrementTimeLimit((Double)timeLimitMinutes * 60);
                    state.setSimTimeLimit(((Double) timeLimitMinutes).intValue() * 60);
                } else {
                    LOGGER.warning("Expected double value for timeLimitMinutes in scenario file. Received: '" +
                            timeLimitMinutes + "'. Time limit not changed.");
                }
            }
            if(GsonUtils.hasKey(obj,"nextScenarioFile")){
                Object nextScenarioFile = GsonUtils.getValue(obj, "nextScenarioFile");
                if(nextScenarioFile.getClass() == String.class) {
                    this.state.setPassthrough(true);
                    state.setNextFileName(nextScenarioFile.toString());
                }
            }

            if(GsonUtils.hasKey(obj,"deepAllowed")) {
                Object deepAllowed = GsonUtils.getValue(obj, "deepAllowed");
                if (deepAllowed.getClass() == Boolean.class) {
                    state.setDeepAllowed((Boolean) deepAllowed);
                }
            }

            if(GsonUtils.hasKey(obj,"modelStyle")){
                Object modelStyle = GsonUtils.getValue(obj, "modelStyle");
                if(modelStyle.getClass() == String.class) {
                    state.setModelStyle((String) modelStyle);
                    // PFM: "parallel" runs the current, one-more and one-fewer agent models together
                    modelCaller.setStyle((String) modelStyle);
                }
            }

            if(GsonUtils.hasKey(obj,"reviewPanel")){
                Object reviewPanel = GsonUtils.getValue(obj, "reviewPanel");
                if(reviewPanel.getClass() == Boolean.class) {
                    state.setShowReviewPanel((Boolean) reviewPanel);
                }
            }

            Object varJson = GsonUtils.getValue(obj, "varianceParameters");
            if (varJson != null) {
                if (GsonUtils.getValue(varJson, "speedPerAgent") != null) {
                    state.putVarianceOption("speedPerAgent", GsonUtils.getValue(varJson, "speedPerAgent"));
                }
                if (GsonUtils.getValue(varJson, "batteryPerAgent") != null) {
                    state.putVarianceOption("batteryPerAgent", GsonUtils.getValue(varJson, "batteryPerAgent"));
                }
            }

            Object noiseJson = GsonUtils.getValue(obj, "noiseParameters");
            if (noiseJson != null) {
                if (GsonUtils.getValue(noiseJson, "speedPerSecond") != null) {
                    state.putNoiseOption("speedPerSecond", GsonUtils.getValue(noiseJson, "speedPerSecond"));
                }
                if (GsonUtils.getValue(noiseJson, "batteryPerStep") != null) {
                    state.putNoiseOption("batteryPerStep", GsonUtils.getValue(noiseJson, "batteryPerStep"));
                }
                if (GsonUtils.getValue(noiseJson, "locationNoise") != null) {
                    state.putNoiseOption("locationNoise", GsonUtils.getValue(noiseJson, "locationNoise"));
                }
            }

            List<Object> uiJson = GsonUtils.getValue(obj, "uIOptions");
            if (uiJson != null) {
                for (Object uIOption : uiJson) {
                    String name = GsonUtils.getValue(uIOption, "name");
                    boolean[] uIPair = new boolean[]{GsonUtils.getValue(uIOption, "default"),
                            GsonUtils.getValue(uIOption, "toggleable")};
                    state.addUIOption(name, uIPair);
                }

            }
            // PFM missions always show the mission cost panel and the add/remove agent buttons. The estimated
            // completion time panel is the scenario's "verification" UI option (off in the control conditions).
            if (state.isPfmMission()) {
                state.addUIOption("missionCost", new boolean[]{true, false});
            }

            if(GsonUtils.hasKey(obj,"uncertaintyRadius")) {
                this.state.setUncertaintyRadius(GsonUtils.getValue(obj, "uncertaintyRadius"));
            } else {
                this.state.setUncertaintyRadius(10.0);
            }
            if(GsonUtils.hasKey(obj,"communicationRange")) {
                this.state.setCommunicationRange(GsonUtils.getValue(obj, "communicationRange"));
            } else {
                this.state.setCommunicationRange(250);
            }
            //this.state.setCommunicationRange(10000000);

            if(GsonUtils.hasKey(obj,"communicationConstrained")){
                Object communicationConstrained = GsonUtils.getValue(obj, "communicationConstrained");
                if(communicationConstrained.getClass() == Boolean.class) {
                    this.state.setCommunicationConstrained((Boolean)communicationConstrained);
                } else {
                    LOGGER.warning("Expected boolean value for communicationConstrained in scenario file. Received: '" +
                            communicationConstrained + "'. Set to false.");
                    // state.communicationConstrained initialised with default value of false
                }
            }

            boolean containsProgrammed = false;
            List<Object> agentsJson = GsonUtils.getValue(obj, "agents");
            if (agentsJson != null) {
                for (Object agentJSon : agentsJson) {
                    Double lat = GsonUtils.getValue(agentJSon, "lat");
                    Double lng = GsonUtils.getValue(agentJSon, "lng");
                    Boolean programmed = false;
                    if(GsonUtils.hasKey(agentJSon,"programmed")){
                        programmed = GsonUtils.getValue(agentJSon, "programmed");
                    }
                    Agent agent;
                    if (programmed) {
                        // This means the agent is a programmed one, and the Hub is set up for this
                        String policy = "GenericAgentPolicy";
                        if (GsonUtils.hasKey(agentJSon, "policy")) {
                            policy = GsonUtils.getValue(agentJSon, "policy");
                        }
                        agent = agentController.addProgrammedAgent(lat, lng, 0, random, taskController, policy);
                        containsProgrammed = true;
                    } else if (this.state.isCommunicationConstrained()) {
                        // This means the agent is a non-programmed one, but there is communication required for the network
                        //agent = agentController.addVirtualCommunicatingAgent(lat, lng, random);
                        agent = agentController.addVirtualAgent(lat, lng, 0);
                    } else {
                        // Neither programmed or communication-required
                        agent = agentController.addVirtualAgent(lat, lng, 0);
                    }
                    Double battery = GsonUtils.getValue(agentJSon, "battery");
                    if(battery != null) {
                        agent.setBattery(battery);
                    }
                    if (GsonUtils.hasKey(agentJSon, "mkr")) {
                        agent.setMarker(GsonUtils.getValue(agentJSon, "mkr"));
                    }
                }
            }

            if (state.isTeamHeatmapUI()) {
                int teamSize = 3;
                if (GsonUtils.getValue(obj, "heatmapTeamSize") instanceof Double d) teamSize = Math.max(1, d.intValue());
                formAgentTeams(teamSize);
            }

            Object hub = GsonUtils.getValue(obj, "hub");
            if(hub != null) {
                Double lat = GsonUtils.getValue(hub, "lat");
                Double lng = GsonUtils.getValue(hub, "lng");

                if (this.state.isCommunicationConstrained() || containsProgrammed) {
                    // Even if it's not constrained, if there are programmed agents then we need to provide hub communication
                    agentController.addHubProgrammedAgent(lat, lng, random, taskController);
                } else {
                    agentController.addHubAgent(lat, lng);
                }
                state.setHubLocation(new Coordinate(lat, lng));
            }

            List<Object> hazards = GsonUtils.getValue(obj, "hazards");
            if (hazards != null) {
                for (Object hazard : hazards) {
                    Double lat = GsonUtils.getValue(hazard, "lat");
                    Double lng = GsonUtils.getValue(hazard, "lng");
                    int type = ((Double) GsonUtils.getValue(hazard, "type")).intValue();
                    if (GsonUtils.hasKey(hazard, "size")) {
                        int size = ((Double) GsonUtils.getValue(hazard, "size")).intValue();
                        hazardController.addHazard(lat, lng, type, size);
                    } else {
                        hazardController.addHazard(lat, lng, type);
                    }
                }
            }

            // Progressive-resolution scouting (AAMAS 2023 demo): must be read before the targets
            if (GsonUtils.hasKey(obj, "scouting")) {
                Object scoutingJson = GsonUtils.getValue(obj, "scouting");
                scoutingController.configure(scoutingJson instanceof Map<?, ?> m ? (Map<String, Object>) m : null);
            }

            List<Object> targetsJson = GsonUtils.getValue(obj, "targets");
            if (targetsJson != null) {
                for (Object targetJson : targetsJson) {
                    Double lat = GsonUtils.getValue(targetJson, "lat");
                    Double lng = GsonUtils.getValue(targetJson, "lng");
                    int type = ((Double) GsonUtils.getValue(targetJson, "type")).intValue();
                    String highRes = GsonUtils.getValue(targetJson, "highRes");
                    String lowRes = GsonUtils.getValue(targetJson, "lowRes");
                    Target target;
                    if (GsonUtils.hasKey(targetJson, "real")) {
                        boolean isReal = GsonUtils.getValue(targetJson, "real");
                        target = targetController.addTarget(lat, lng, type, isReal);
                        ((AdjustableTarget) target).setFilenames(lowRes, highRes);
                    } else {
                        target = targetController.addTarget(lat, lng, type);
                    }

                    if (scoutingController.isEnabled() && target instanceof AdjustableTarget at) {
                        // Scouting: every target is known and gets its own task
                        scoutingController.addTarget(at);
                    } else {
                        //Hide all targets initially - they must be found!!
                        targetController.setTargetVisibility(target.getId(), false);
                    }
                }
            }

            List<Object> markers = GsonUtils.getValue(obj, "markers");
            if (markers != null) {
                for (Object markerJson : markers) {
                    String shape = GsonUtils.getValue(markerJson, "shape");
                    Double cLat = GsonUtils.getValue(markerJson, "centreLat");
                    Double cLng = GsonUtils.getValue(markerJson, "centreLng");
                    Double radius = GsonUtils.getValue(markerJson, "radius");

                    String shapeRep = shape+","+cLat+","+cLng+","+radius;

                    this.state.getMarkers().add(shapeRep);
                }
            }
            List<Object> tasksJson = GsonUtils.getValue(obj, "tasks");
            if (tasksJson != null) {
                for (Object taskJson : tasksJson) {
                    Double lat = GsonUtils.getValue(taskJson, "lat");
                    Double lng = GsonUtils.getValue(taskJson, "lng");
                    int type = ((Double) GsonUtils.getValue(taskJson, "type")).intValue();
                    Task task = taskController.createTask(type, lat, lng);
                }
            }

            if(GsonUtils.hasKey(obj,"uncertaintyRadius")) {
                this.state.setUncertaintyRadius(GsonUtils.getValue(obj, "uncertaintyRadius"));
            }

            if(GsonUtils.hasKey(obj,"missionController")) {
                Object missionController = GsonUtils.getValue(obj, "missionController");
                this.missionController = new MissionController(this);

                if(GsonUtils.hasKey(missionController,"spawnRadius")) {
                    this.missionController.setSpawnRadius((GsonUtils.getValue(missionController, "spawnRadius")));
                }

                List<Object> spawnPairs = GsonUtils.getValue(missionController, "taskSpawnTrack");
                if (spawnPairs != null) {
                    for (Object spawnPair : spawnPairs) {
                        Integer spawnTime = ((Double) GsonUtils.getValue(spawnPair, "spawnTime")).intValue();
                        Integer spawnRate = ((Double) GsonUtils.getValue(spawnPair, "spawnRate")).intValue();

                        this.missionController.addPair(spawnTime, spawnRate);
                    }
                    this.missionController.orderPairs();
                }

            }

            this.state.setGameSpeed((int) BASE_TICK_RATE);

            return true;
        } catch (IOException e) {
            e.printStackTrace();
        }
        return false;
    }

    private String getScenarioNameFromFile(String scenarioFile) {
        try {
            String json = GsonUtils.readFile(scenarioFile);
            Object obj = GsonUtils.fromJson(json);
            return GsonUtils.getValue(obj, "gameId");
        } catch (IOException e) {
            e.printStackTrace();
        }
        return null;
    }

    private static boolean sleep(long millis) {
        try {
            if (millis > 0) {
                Thread.sleep(millis);
            }
            return true;
        } catch (InterruptedException e) {
            // TODO make this more graceful when state is reset
            e.printStackTrace();
            return false;
        }
    }

    /**
     * Prints the complete belief for each programmed agent
     */
    private void printBeliefs() {
        ArrayList<String> beliefs = agentController.getBelievedModels();
        System.out.println("===========Beliefs===========");
        for (String b : beliefs) {
            System.out.println(b);
            System.out.println();
        }
    }

    /**
     * Prints the complete belief for the programmed hub
     */
    private void printHubBelief() {
        ArrayList<String> beliefs = agentController.getHubBelief();
        System.out.println("===========HUB Belief===========");
        for (String b : beliefs) {
            System.out.println(b);
            System.out.println();
        }
    }

    /**
     * Prints the state as a JSON
     */
    private void printStateJson() {
        String stateJson = GsonUtils.toJson(state);
        System.out.println(stateJson);
    }

    public synchronized String getStateAsString() {
        return state.toString();
    }

    public synchronized State getState() {
        return state;
    }

    public Allocator getAllocator() {
        return this.allocator;
    }

    public AgentController getAgentController() {
        return agentController;
    }

    public TaskController getTaskController() {
        return taskController;
    }

    public TargetController getTargetController() {
        return targetController;
    }

    public QueueManager getQueueManager() {
    //    return queueManager;
        return null;
    }

    public EpisodeController getEpisodeController() {
        return episodeController;
    }

    public StratTacController getStratTacController() {
        return stratTacController;
    }

    /** The page the launcher should open for the loaded scenario (its "page" key), or null for the sandbox. */
    public String getScenarioPage() {
        return scenarioPage;
    }

    /** Writes the per-episode CSV summary of the degradation study next to the run's log file. */
    private void processStudyLog() {
        if (currentLogFile == null)
            return;
        try {
            for (java.util.logging.Handler h : LOGGER.getHandlers())
                h.flush();
            tool.LogProcessor.processLogFile(currentLogFile);
        } catch (Exception e) {
            LOGGER.warning("Could not summarise the study log: " + e.getMessage());
        }
    }

    public ScoutingController getScoutingController() {
        return scoutingController;
    }

    public ImageController getImageController() {
        return imageController;
    }

    public Random getRandom() {
        return random;
    }

    public double getTickRate() {
        return highTickRate;
    }

    public ScoreController getScoreController() {
        return scoreController;
    }

    public MissionController getMissionController() {
        return missionController;
    }

    public double getStepScale() {
        return state.getMotionScale() * BASE_TICK_RATE / highTickRate;
    }

    /** Fraction of a 5 Hz tick that one tick represents (1 at 5 Hz, 0.5 at 10 Hz). */
    public double getTickFraction() {
        return BASE_TICK_RATE / highTickRate;
    }

    public double getSimSpeed() {
        return simSpeed;
    }

    /**
     * Change the simulation speed and tick rate while it runs. Values are clamped to the supported range.
     * Behaviour per simulated second stays the same; only smoothness (tick rate) and pace (speed) change.
     */
    public synchronized void setTiming(Double speed, Double tickRate) {
        if (speed != null && !speed.isNaN())
            simSpeed = Math.max(MIN_SIM_SPEED, Math.min(MAX_SIM_SPEED, speed));
        if (tickRate != null && !tickRate.isNaN())
            highTickRate = Math.max(MIN_TICK_RATE, Math.min(MAX_TICK_RATE, Math.round(tickRate)));
        state.setTiming(simSpeed, highTickRate);
    }

    public void incrementCompletedTargets() {
        completedTargets++;
    }
}
