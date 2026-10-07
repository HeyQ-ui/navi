import type { AssessmentSource } from '../api.js'

/**
 * 测评来源的中文名。首页入口、结果页、历史列表与历史详情都在显示它——
 * 改名必须一起改，所以放一处共享：同一件事出现两种说法，迟早会走样。
 */
export const SOURCE_LABELS: Record<AssessmentSource, string> = {
  self: '测测自己',
  other: '临时测试',
}
