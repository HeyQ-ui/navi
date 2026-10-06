import { Link, useLocation } from 'wouter'
import { useFlow } from '../state.js'
import { useTitle } from '../lib/use-title.js'
import type { AssessmentSource } from '../api.js'

const STEPS = [
  { num: '01', title: '回答一组问题', text: '按你的年级取题，五题一组，跟着自己的感觉答就好' },
  { num: '02', title: '得到你的倾向', text: '根据你的回答，算出你的生涯倾向，看看七条路径里哪条更适合你' },
  { num: '03', title: '看清路的真相', text: '你想听和不想听的，都摆在你面前' },
]

const PROMISES = [
  { title: '提供参考', text: '为你提供大学路径真相和参考，你的路由你来选择。' },
  { title: '如实相告', text: '没有数据支撑的数字，一个都不写给你看。' },
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
          先看清自己，再看清<span className="text-accent">路</span>。
        </h1>
        <p className="mx-auto mt-5 max-w-[520px] text-[16px] text-ink-2">
          回答一组问题，得到你的生涯倾向，讲清路径的信息，并向Navi提问。
        </p>
        <div className="mt-9 flex justify-center gap-4">
          <button type="button" className="btn-primary px-8 py-3 text-[16px]" onClick={() => start('self')}>
            测测自己
          </button>
          <button type="button" className="btn-secondary px-8 py-3 text-[16px]" onClick={() => start('other')}>
            测测别人
          </button>
        </div>
        <p className="mt-5 text-[13px] text-ink-3">约5分钟</p>
      </section>

      <section className="animate-rise border-t border-line py-14" style={{ animationDelay: '60ms' }}>
        <h2 className="mb-8 font-serif text-[19px] font-black">它怎么运作</h2>
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
        <h2 className="mb-8 font-serif text-[19px] font-black">我们的承诺</h2>
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
        <p className="mt-12 text-center text-[13px] text-ink-3">
          也可以先随便看看——<Link href="/path/same-discipline-baoyan" className="text-accent-deep">任一路径的真相</Link>不登录也能读。
        </p>
      </section>
    </div>
  )
}
