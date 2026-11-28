import { generateSessionPlan, TASK_BASE_TIME } from '../src/utils/missionGen.ts'
import { SeededRNG } from '../src/utils/prng.ts'
import { computeTacticalSuggestion } from '../src/utils/tacticalSuggest.ts'
const out: string[] = []
const P: any = { Blue: 'B', Red: 'R', Green: 'G' }
for (const cx of ['balanced','strategic','tactical','full']) for (let seed = 1; seed <= 40; seed++) {
  generateSessionPlan(new SeededRNG(seed), cx as any).forEach((bp, k) => {
    const tasks = bp.taskTypes.map((type, i) => ({ id: `${bp.id}-T${i+1}`, missionId: bp.id, type, status: 'pending', waypoint: bp.waypoints[i], assignedAssetIds: [], baseTime: TASK_BASE_TIME[type] })) as any[]
    const h = seed * 31 + k * 7
    const n: any = { Blue: 1 + h % 4, Red: 1 + (h*3) % 4, Green: 1 + (h*5) % 4 }
    const assets: any[] = []
    for (const ty of ['Blue','Red','Green']) for (let i = 1; i <= n[ty]; i++) assets.push({ id: P[ty] + String(i).padStart(2,'0'), type: ty, status: 'available', position: { x: 500, y: 400 } })
    const order = [...tasks].sort((a, b) => b.type - a.type).map(t => t.id)
    for (const greedy of [false, true]) {
      const r = computeTacticalSuggestion(assets.map(a => a.id), order, tasks, assets, greedy)
      out.push([cx, seed, bp.id, greedy, Object.keys(r).sort().map(t => t + '=' + r[t].join(',')).join(';')].join('|'))
    }
  })
}
console.log(out.join('\n'))
