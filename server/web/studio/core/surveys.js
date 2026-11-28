// Questionnaires of the strategic/tactical study, as in the original: the background questionnaire shown before
// session 1 of a participant study, and the surveys after each session. Ids are the logged response keys.

const FREQUENCY = ["Never", "Rarely", "Occasionally", "Weekly", "Daily"];
const EXPERIENCE = ["None", "A little", "Moderate", "Extensive"];
const AGREEMENT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

const ABOUT = "About you";
const AIAS = "Your views on AI";
const VERIFICATION = "Working with AI tools";
const DELEGATION = "AI and decision-making";
const UNDERSTANDING = "Before you start";

const aias = (id, label) => ({ id, section: AIAS, label, type: "scale", min: 1, max: 10, minLabel: "Not at all", maxLabel: "Completely agree" });
const likert7 = (section) => (id, label, help) => ({ id, section, label, help, type: "scale", min: 1, max: 7, minLabel: "Strongly disagree", maxLabel: "Strongly agree" });
const verif = likert7(VERIFICATION), deleg = likert7(DELEGATION);
const understand = (id, label) => ({ id, section: UNDERSTANDING, label, type: "choice", options: AGREEMENT });

// Block A is AIAS-4 (Grassini, 2023; verbatim, 10-point). Blocks B and C are bespoke 7-point scales with some
// reverse-keyed items; responses are logged raw and reverse-scored at analysis time.
export const DEMOGRAPHICS = [
    { id: "age", section: ABOUT, label: "Age", type: "number", min: 18, max: 100 },
    { id: "gender", section: ABOUT, label: "Gender", type: "choice", options: ["Male", "Female", "Non-binary", "Prefer not to say", "Other"] },
    { id: "education", section: ABOUT, label: "Highest level of education completed", type: "choice",
        options: ["Secondary / high school", "Undergraduate degree", "Postgraduate / master’s", "Doctorate", "Other"] },
    { id: "field", section: ABOUT, label: "Field of study or occupation", type: "text", help: "e.g. Computer Science, Nursing, Logistics" },
    { id: "gaming_frequency", section: ABOUT, label: "How often do you play video games (any kind)?", type: "choice", options: FREQUENCY },
    { id: "sim_experience", section: ABOUT, label: "Experience with simulation software or simulation games",
        help: "e.g. flight / driving simulators, city-builders, management sims", type: "choice", options: EXPERIENCE },
    { id: "strategy_experience", section: ABOUT, label: "Experience with real-time strategy or resource-management games",
        help: "e.g. StarCraft, Age of Empires, Factorio, Command & Conquer", type: "choice", options: EXPERIENCE },
    { id: "drone_experience", section: ABOUT, label: "Experience operating drones or UAVs", type: "choice", options: EXPERIENCE },
    { id: "autonomy_experience", section: ABOUT, label: "Experience working with automation, AI assistants, or autonomous systems", type: "choice", options: EXPERIENCE },
    { id: "command_experience", section: ABOUT, label: "Experience with emergency management, dispatch, air traffic control, or military command", type: "choice", options: EXPERIENCE },

    { id: "aias_overview", section: AIAS, type: "info",
        label: 'For the next few questions, "AI" refers to artificial intelligence in general — things like virtual assistants (e.g. Siri, Alexa), '
            + "recommendation algorithms (e.g. what streaming or shopping sites suggest to you), grammar and writing checkers, and chatbots (e.g. ChatGPT)." },
    aias("aias_improve_life", "I believe that AI will improve my life."),
    aias("aias_improve_work", "I believe that AI will improve my work."),
    aias("aias_future_use", "I think I will use AI technology in the future."),
    aias("aias_positive_humanity", "I think AI technology is positive for humanity."),

    verif("verif_check_before_relying", "I usually check an AI tool's work before relying on it."),
    verif("verif_comfortable_unreviewed", "I would be comfortable using an AI tool's output without reviewing it."),
    verif("verif_want_reasoning", "When an AI tool gives me an answer, I want to see the reasoning behind it."),
    verif("verif_happy_unsupervised", "I am happy to let AI tools work on their own without my involvement."),
    verif("verif_overconfident", "AI tools tend to be more confident in their answers than they should be."),
    verif("verif_reliable_no_check", "Most AI tools are reliable enough that checking their work is unnecessary."),
    verif("verif_hard_to_detect_errors", "I find it difficult to tell when an AI tool has made a mistake.",
        "Optional moderator item — kept separate from the verification-propensity score above."),

    deleg("deleg_human_final_say", "A human should make the final decision even when an AI recommendation is available."),
    deleg("deleg_trust_suggest_over_decide", "I trust AI more for suggesting options than for making decisions."),
    deleg("deleg_prefer_self_even_if_slower", "I would rather do a task myself than delegate it to an AI, even if it took me longer."),
    deleg("deleg_not_when_lives_at_stake", "AI should not be relied on in situations where lives are at stake."),
    deleg("deleg_urgent_better_than_nothing", "In an urgent situation, an AI recommendation is better than no recommendation at all."),

    understand("understand_role", "I understand my role as the operator in this operation."),
    understand("understand_missions", "I understand how to allocate drones to a mission."),
    understand("understand_strategic", "I understand what the Strategic Assistant is for."),
    understand("understand_tactical", "I understand what the Tactical Assistant is for."),
    understand("understand_scoring", "I understand how my performance is measured."),
];

const NASA_ITEMS = [
    { id: "mental_demand", question: "How mentally demanding was the task?", leftLabel: "Low", rightLabel: "High" },
    { id: "physical_demand", question: "How physically demanding was the task?", leftLabel: "Low", rightLabel: "High" },
    { id: "temporal_demand", question: "How hurried or rushed was the pace of the task?", leftLabel: "Low", rightLabel: "High" },
    { id: "performance", question: "How successful were you in accomplishing what you were asked to do?", leftLabel: "Perfect", rightLabel: "Failure",
        help: "This one runs the opposite way to the others — drag toward Perfect for a good outcome, toward Failure for a bad one." },
    { id: "effort", question: "How hard did you have to work to accomplish your level of performance?", leftLabel: "Low", rightLabel: "High" },
    { id: "frustration", question: "How insecure, discouraged, irritated, stressed, or annoyed were you?", leftLabel: "Low", rightLabel: "High" },
];

const trust = (p, who) => [
    { id: p + "_reliable", question: `The ${who} is reliable.` },
    { id: p + "_trust", question: `I trust the ${who}'s recommendations.` },
    { id: p + "_performs", question: `The ${who} performs well.` },
    { id: p + "_confident", question: `I feel confident using the ${who}.` },
    { id: p + "_useful", question: `The ${who} provides useful guidance.` },
    { id: p + "_follow", question: `I would follow the ${who}'s suggestions without hesitation.` },
];
const tam = (p, who) => [
    { id: p + "_tam_perf", question: `Using the ${who} improves my task performance.` },
    { id: p + "_tam_useful", question: `Using the ${who} is useful for this task.` },
    { id: p + "_tam_easy_learn", question: `Learning to use the ${who} was easy.` },
    { id: p + "_tam_easy_use", question: `I find the ${who} easy to use overall.` },
];
const LIKERT_SUB = "Rate your agreement with each statement (1 = strongly disagree, 7 = strongly agree)";

export const SURVEYS = {
    nasa_tlx: { title: "Workload Assessment", subtitle: "NASA Task Load Index — rate the session you just completed (0 = low, 20 = high)", type: "nasa", items: NASA_ITEMS },
    trust_strategic: { title: "Trust in Strategic Assistant", subtitle: LIKERT_SUB, type: "likert", items: trust("strat", "Strategic Assistant") },
    trust_tactical: { title: "Trust in Tactical Assistant", subtitle: LIKERT_SUB, type: "likert", items: trust("tact", "Tactical Assistant") },
    tam_strategic: { title: "Strategic Assistant — Usability", subtitle: LIKERT_SUB, type: "likert", items: tam("strat", "Strategic Assistant") },
    tam_tactical: { title: "Tactical Assistant — Usability", subtitle: LIKERT_SUB, type: "likert", items: tam("tact", "Tactical Assistant") },
};

// Sessions 1 and 2: workload and trust; session 3 adds the usability scales
const BY_SESSION = {
    1: ["nasa_tlx", "trust_strategic", "trust_tactical"],
    2: ["nasa_tlx", "trust_strategic", "trust_tactical"],
    3: ["nasa_tlx", "trust_strategic", "trust_tactical", "tam_strategic", "tam_tactical"],
};

export function surveysForSession(n) {
    return BY_SESSION[n] || BY_SESSION[1];
}

export const COMPLEXITIES = [
    { value: "balanced", label: "Balanced", desc: "Med Strategic / Med Tactical · 11F 11L 12C" },
    { value: "tactical", label: "Tactical Heavy", desc: "Low Strategic / High Tactical · few large missions · 11F 11L 12C" },
    { value: "strategic", label: "Strategic Heavy", desc: "High Strategic / Low Tactical · many small missions · 11F 11L 12C" },
    { value: "full", label: "Full Spectrum", desc: "High Strategic / High Tactical · frequent large missions · 11F 11L 12C" },
    { value: "quick", label: "Quick Test", desc: "Dev only · 5F 5L 5C" },
];
