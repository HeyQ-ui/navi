import { Link, useLocation } from 'wouter'
import { SOURCE_LABELS } from '../lib/source-label.js'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'
import type { AssessmentSource } from '../api.js'

const STEPS = [
  { num: '01', title: '回答一组问题', text: '按你的年级取题，如实作答' },
  { num: '02', title: '得到你的倾向', text: '根据你的回答，得到你的生涯倾向，看看七条路径里哪条更适合你' },
  { num: '03', title: '相对全面的了解路径', text: '从时间节点、时间段行动建议、风险等角度了解路径' },
]

const PROMISES = [
  { title: '提供参考', text: '为你提供大学路径真相和参考，你的路由你来选择。' },
  { title: '如实相告', text: 'Navi的知识均从专业论文中得到，详见七种大学生路径→参考文献' },
  { title: '放平心态', text: '路径没有高低，只有适不适合你。' },
]

export function HomePage() {
  useTitle('Navi · 大学生生涯规划')
  const flow = useFlow()
  const [, navigate] = useLocation()

  function start(source: AssessmentSource) {
    flow.startAssessment(source)
    if (flow.account === null) {
      flow.setAuthRedirect('/grade')
      navigate('/auth')
    } else {
      navigate('/grade')
    }
  }

  return (
    <div className="mx-auto max-w-prose px-6">
      <section className="animate-rise pb-20 pt-24 text-center">
        <h1 className="font-serif text-[42px] font-black leading-[1.35]">
          大学生生涯规划Agent
        </h1>
        <p className="mx-auto mt-5 max-w-[520px] text-[16px] text-ink-2">
          测试自己的画像和匹配路径，或者直接查看全部路径
        </p>
        <div className="mt-9 flex justify-center gap-4">
          <button type="button" className="btn-primary px-8 py-3 text-[16px]" onClick={() => start('self')}>
            测测自己
          </button>
          <Link href="/paths" className="btn-secondary px-8 py-3 text-[16px]">
            查看七种大学生路径
          </Link>
        </div>
        <p className="mt-5 text-[13px] text-ink-3">
          测试约5分钟 · 也可以直接做
          <button
            type="button"
            className="text-accent-deep underline underline-offset-4 transition-colors hover:text-accent"
            onClick={() => start('other')}
          >
            {SOURCE_LABELS.other}
          </button>
        </p>
      </section>

      <section className="animate-rise border-t border-line py-14" style={{ animationDelay: '60ms' }}>
        <h2 className="mb-8 font-serif text-[19px] font-black">如何使用Navi</h2>
        <ol className="space-y-6">
          {STEPS.map(step => (
            <li key={step.num} className="flex items-baseline gap-5 border-b border-line pb-5 last:border-b-0">
              <span className="font-num text-[15px] font-semibold text-accent">{step.num}</span>
              <div>
                <p className="font-serif text-[16px] font-semibold">{step.title}</p>
                <p className="mt-0.5 text-[14px] text-ink-2">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="animate-rise border-t border-line py-14" style={{ animationDelay: '120ms' }}>
        <h2 className="mb-8 font-serif text-[19px] font-black">关于Navi</h2>
        <ul className="space-y-4">
          {PROMISES.map(item => (
            <li key={item.title} className="flex items-baseline gap-5">
              <span className="w-20 shrink-0 font-serif text-[15px] font-semibold text-accent-deep">
                {item.title}
              </span>
              <span className="text-[15px] text-ink-2">{item.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
