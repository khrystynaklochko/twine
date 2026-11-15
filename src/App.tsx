import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TwinProvider } from './context/TwinContext';
import { LandingPage } from './pages/LandingPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { TwinMemoryPage } from './pages/TwinMemoryPage';
import { TeachPage } from './pages/TeachPage';
import { SkillsPage } from './pages/SkillsPage';
import { AgentCockpitPage } from './pages/AgentCockpitPage';
import { HistoryLedgerPage } from './pages/HistoryLedgerPage';
import { PrivacySettingsPage } from './pages/PrivacySettingsPage';
import { FixtureResearchPage } from './pages/FixtureResearchPage';
import { DemoPage } from './pages/DemoPage';

export default function App() {
  return (
    <BrowserRouter>
      <TwinProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/twin" element={<TwinMemoryPage />} />
          <Route path="/teach" element={<TeachPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/agent" element={<AgentCockpitPage />} />
          <Route path="/history" element={<HistoryLedgerPage />} />
          <Route path="/settings/privacy" element={<PrivacySettingsPage />} />
          <Route path="/fixture/research" element={<FixtureResearchPage variant="v1" />} />
          <Route path="/fixture/research-v2" element={<FixtureResearchPage variant="v2" />} />
          <Route path="/fixture/adversarial" element={<FixtureResearchPage variant="adversarial" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TwinProvider>
    </BrowserRouter>
  );
}
