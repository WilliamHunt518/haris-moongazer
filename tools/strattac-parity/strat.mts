import { generateSessionPlan, TASK_BASE_TIME } from '../src/utils/missionGen.ts'
import { SeededRNG } from '../src/utils/prng.ts'
import { generateStrategies } from '../src/utils/copilot.ts'
const cols = ['Blue','Red','Green'] as const
const out: string[] = []
for (const cx of ['balanced','strategic','tactical','full']) for (let seed = 1; seed <= 40; seed++) {
  const plan = generateSessionPlan(new SeededRNG(seed), cx as any)
  plan.forEach((bp, k) => {
    const tasks = bp.taskTypes.map((type, i) => ({ id: `${bp.id}-T${i+1}`, missionId: bp.id, type, status: 'pending', waypoint: bp.waypoints[i], assignedAssetIds: [], baseTime: TASK_BASE_TIME[type] })) as any
    const h = seed * 31 + k * 7
    const reserve = { Blue: h % 12, Red: (h * 3) % 12, Green: (h * 5) % 12 }
    const fires = (h % 3) === 0
    const colour = cols[h % 3]
    const s = generateStrategies(tasks, reserve, 0, new SeededRNG(1), undefined, { fires, colour })
    for (const c of s) out.push([cx, seed, bp.id, c.name, c.assets.Blue, c.assets.Red, c.assets.Green, c.expectedCompletionTime, c.speedScore, c.reserveScore, c.redundancyScore, !!c.isBadSuggestion, c.badSuggestionColour ?? ''].join('|'))
  })
}
console.log(out.join('\n'))
