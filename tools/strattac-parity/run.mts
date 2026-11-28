console.debug = () => {}
import { buildInitialState, gameReducer } from '../src/store/gameReducer.ts'
import { TASK_PRIMARY } from '../src/utils/missionGen.ts'
import { computeRecoverySuggestion } from '../src/utils/tacticalSuggest.ts'
const CX = (process.argv[2] ?? 'balanced,strategic,tactical,full').split(',')
const NS = parseInt(process.argv[3] ?? '20')
const DT = 0.1
const pen: any = { A: 1, B: 2, C: 3, D: 4, E: 5 }
function floor(tasks: any[]) { const r: any = { Blue: 0, Red: 0, Green: 0 }; for (const t of tasks) { const c: any = (TASK_PRIMARY as any)[t.type]; for (const k in r) r[k] = Math.max(r[k], c[k]) } return r }
const out: string[] = []
for (const cx of CX) for (let seed = 1; seed <= NS; seed++) {
  let s: any = buildInitialState({ participantId: 'SIM', condition: 'none', mode: 'agent', complexity: cx, seed, agentErrorRate: 0, epsilonTactical: 0,
    tacticalMode: 'plan-all', testingMode: false, tutorialMode: false, numSessions: 1, fixLockouts: true, collectDemographics: false } as any)
  const D = (a: any) => { s = gameReducer(s, a) }
  const recSince: Record<string, number> = {}
  for (let i = 0; i < 480 / DT + 20 && s.phase === 'playing'; i++) {
    D({ type: 'TICK', nowMs: i * DT * 1000 })
    if (s.phase !== 'playing') break
    if (s.trustProbeActive) D({ type: 'DISMISS_TRUST_PROBE' })
    for (const m of s.missions) {
      if (!m.failureRecoveryPending) { delete recSince[m.id]; continue }
      recSince[m.id] ??= s.elapsed
      if (s.elapsed - recSince[m.id] > 30) { D({ type: 'ABANDON_MISSION', missionId: m.id }); continue }
      const deployed = s.assets.filter((a: any) => a.currentMissionId === m.id && a.status === 'deployed').map((a: any) => a.id)
      const open = m.tasks.filter((t: any) => t.status !== 'completed' && t.status !== 'failed')
      const order = [...open].sort((a: any, b: any) => b.type - a.type).map((t: any) => t.id)
      const cur: Record<string, string[]> = {}
      for (const t of m.tasks) if (t.status === 'pending' || t.status === 'traveling') cur[t.id] = t.assignedAssetIds.filter((id: string) => deployed.includes(id))
      const sug = computeRecoverySuggestion(m, { dronePool: deployed, taskOrder: order, taskAssignments: cur } as any, s.assets, cur)
      D({ type: 'CONFIRM_FAILURE_RECOVERY', missionId: m.id, taskAssignments: { ...cur, ...sug }, wasAgentSuggested: true })
    }
    const queued = s.missions.filter((m: any) => m.status === 'queued').sort((a: any, b: any) => pen[b.category] - pen[a.category])
    for (const m of queued) {
      const r: any = { Blue: 0, Red: 0, Green: 0 }; for (const a of s.assets) if (a.status === 'available') r[a.type]++
      const fl = floor(m.tasks)
      if (r.Blue < fl.Blue || r.Red < fl.Red || r.Green < fl.Green) continue
      D({ type: 'OPEN_STRATEGIC', missionId: m.id })
      if (!s.strategicModal || s.strategicModal.missionId !== m.id) continue
      const idx = s.strategicModal.strategies.findIndex((x: any) => x.name === 'Aggressive')
      const use = idx >= 0 ? idx : (s.strategicModal.strategies.length ? 0 : -1)
      if (use < 0) { D({ type: 'CLOSE_STRATEGIC' }); continue }
      D({ type: 'APPLY_STRATEGIC', missionId: m.id, source: 'agent', strategyIndex: use, manualAllocation: null })
      if (s.missions.find((x: any) => x.id === m.id)?.tacticalPending) D({ type: 'CONFIRM_TACTICAL', missionId: m.id })
    }
  }
  const ev = s.events.flat()
  const cnt = (t: string) => ev.filter((e: any) => e.type === t).length
  const mis = s.missions.filter((m: any) => !m.id.endsWith('-R'))
  out.push([cx, seed, s.score.toFixed(3), s.penaltyAccrued.toFixed(3), mis.length, s.missions.filter((m: any) => m.status === 'completed').length,
    cnt('task_completed'), cnt('task_failed'), cnt('drone_failure'), cnt('mission_abandoned'), cnt('lockout_detected'), ev.length].join('|'))
}
console.log(out.join('\n'))
