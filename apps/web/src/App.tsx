import { Redirect, Route, Switch } from 'wouter'
import { TopBar } from './components/TopBar.js'
import { AuthPage } from './pages/AuthPage.js'
import { GradePage } from './pages/GradePage.js'
import { HistoryDetailPage } from './pages/HistoryDetailPage.js'
import { HistoryPage } from './pages/HistoryPage.js'
import { HomePage } from './pages/HomePage.js'
import { PathDetailPage } from './pages/PathDetailPage.js'
import { QuizPage } from './pages/QuizPage.js'
import { ResultPage } from './pages/ResultPage.js'
import { FlowProvider } from './state.js'

/** App 只有全局外壳：会话上下文 + 顶栏 + 路由表。守卫与过渡动画都在页面内，这里不重复 */
export function App() {
  return (
    <FlowProvider>
      <TopBar />
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/auth" component={AuthPage} />
        <Route path="/grade" component={GradePage} />
        <Route path="/quiz" component={QuizPage} />
        <Route path="/result" component={ResultPage} />
        <Route path="/path/:pathId">
          {params => <PathDetailPage pathId={params.pathId} />}
        </Route>
        <Route path="/history" component={HistoryPage} />
        <Route path="/history/:recordId">
          {params => <HistoryDetailPage recordId={params.recordId} />}
        </Route>
        {/* 兜底：未知路由一律回首页 */}
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
    </FlowProvider>
  )
}
