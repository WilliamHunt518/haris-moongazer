import { generateSessionPlan } from '../src/utils/missionGen.ts'
import { SeededRNG } from '../src/utils/prng.ts'
const out: string[] = []
for (const cx of ['balanced','strategic','tactical','full','quick']) for (let seed = 1; seed <= 60; seed++) for (const idx of [1,2]) {
  const plan = generateSessionPlan(new SeededRNG(seed ^ idx), cx as any)
  for (const b of plan) out.push([cx, seed, idx, b.id, b.arrivalTime, b.category, b.taskTypes.join(''), b.zoneCenter.x, b.zoneCenter.y, b.waypoints.map(w => w.x + ',' + w.y).join(';')].join('|'))
}
console.log(out.join('\n'))
