import type { Answers } from '../types.js'

export interface GoldenCase {
  name: string
  description: string
  answers: Answers
  /** 期望出现在首选推荐中的路径 id */
  expectTopPath: string
  /** 期望必须出现在结果里的路径 id */
  expectPresent?: string[]
}

/**
 * 黄金案例集（设计文档 §11.3）。
 *
 * 既是回归测试，也是内容校对工具：知识库改权重或内容组增删题目后，
 * 运行本文件可立即看到典型学生的推荐结果是否发生异常漂移。
 *
 * answers 中的题目 id 必须与 packages/knowledge/questions/ 下的真实题目一致——
 * golden.test.ts 的「答案指向真实题目」用例会捕获不一致。
 *
 * 选项下标是 0–4：写下标 5 的作答会被当成未作答（选项根本不存在），
 * 静默地少算一道题，因此越界值在这里没有意义，写错就是脏数据。
 */
export const GOLDEN_CASES: GoldenCase[] = [
  {
    name: '学业专注、认同本专业的新生',
    description: '学术志趣与积累行动力靠前，认同本专业，明确想走保研，公共事务倾向低',
    answers: {
      'grad-intention-1': 0,
      'academic-interest-1': 4,
      'academic-interest-2': 4,
      'academic-interest-3': 4,
      'accumulation-drive-4': 4,
      'discipline-identity-1': 4,
      'discipline-identity-2': 4,
      'discipline-identity-3': 3,
      'cost-tolerance-1': 3,
      'cost-tolerance-2': 3,
      'cost-tolerance-3': 3,
      'risk-preference-1': 3,
      'risk-preference-2': 4,
      'risk-preference-4': 3,
      'stress-endurance-1': 4,
      'stress-endurance-2': 4,
      'stress-endurance-3': 4,
      'public-affairs-leaning-1': 0,
      'public-affairs-leaning-2': 0,
      'public-affairs-leaning-3': 0,
      'accumulation-drive-1': 2,
      'accumulation-drive-2': 2,
      'accumulation-drive-3': 2,
      'eligibility-tuimian-quota': 0,
    },
    expectTopPath: 'same-discipline-baoyan',
  },
  {
    name: '想换赛道的行动派',
    description: '不认同本专业，行动力极强，学术志趣低，愿意冒险，不打算读研',
    answers: {
      'grad-intention-1': 2,
      'academic-interest-1': 1,
      'academic-interest-2': 2,
      'academic-interest-3': 1,
      'discipline-identity-1': 0,
      'discipline-identity-2': 0,
      'discipline-identity-3': 1,
      'cost-tolerance-1': 1,
      'cost-tolerance-2': 1,
      'cost-tolerance-3': 2,
      'risk-preference-1': 3,
      'risk-preference-2': 3,
      'risk-preference-4': 4,
      'stress-endurance-1': 2,
      'stress-endurance-2': 3,
      'stress-endurance-3': 3,
      'public-affairs-leaning-1': 1,
      'public-affairs-leaning-2': 2,
      'public-affairs-leaning-3': 1,
      'accumulation-drive-1': 4,
      'accumulation-drive-2': 4,
      'accumulation-drive-3': 4,
      'eligibility-tuimian-quota': 1,
    },
    expectTopPath: 'cross-discipline-job',
    expectPresent: ['cross-discipline-baoyan', 'same-discipline-baoyan'],
  },
  {
    name: '求稳的公共事务型',
    description: '公共事务倾向与风险规避均高，学术志趣偏低，不打算读研',
    answers: {
      'grad-intention-1': 2,
      'academic-interest-1': 1,
      'academic-interest-2': 1,
      'academic-interest-3': 2,
      'discipline-identity-1': 2,
      'discipline-identity-2': 2,
      'discipline-identity-3': 3,
      'cost-tolerance-1': 2,
      'cost-tolerance-2': 2,
      'cost-tolerance-3': 2,
      'risk-preference-1': 4,
      'risk-preference-2': 4,
      'risk-preference-4': 4,
      'stress-endurance-1': 3,
      'stress-endurance-2': 3,
      'stress-endurance-3': 3,
      'public-affairs-leaning-1': 4,
      'public-affairs-leaning-2': 4,
      'public-affairs-leaning-3': 4,
      'accumulation-drive-1': 2,
      'accumulation-drive-2': 2,
      'accumulation-drive-3': 2,
      'eligibility-tuimian-quota': 0,
    },
    expectTopPath: 'civil-service',
  },
]
