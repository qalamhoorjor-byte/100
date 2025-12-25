import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import OAuthCallback from "@/pages/OAuthCallback";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Workflow from "./pages/Workflow";
import Agents from "./pages/Agents";
import Results from "./pages/Results";
import Settings from "./pages/Settings";
import Publish from "./pages/Publish";
import PublishHistory from "./pages/PublishHistory";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Partnership from "./pages/Partnership";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Cookies from "./pages/Cookies";
import Legal from "./pages/Legal";
import NotFound from "./pages/NotFound";
import Onboarding from "./pages/Onboarding";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminModeration from "./pages/admin/AdminModeration";
import AdminAnalytics from "./pages/admin/AdminAnalytics";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminActivityLogs from "./pages/admin/AdminActivityLogs";
import AdminFeatureToggles from "./pages/admin/AdminFeatureToggles";
import AdminContentEditor from "./pages/admin/AdminContentEditor";
import AdminIntroVideo from "./pages/admin/AdminIntroVideo";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <LanguageProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/" element={<Index />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/partnership" element={<Partnership />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/cookies" element={<Cookies />} />
              <Route path="/legal" element={<Legal />} />
              
              {/* Onboarding */}
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              
              {/* Protected routes */}
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/workflow" element={<ProtectedRoute><Workflow /></ProtectedRoute>} />
              <Route path="/workflow/:id" element={<ProtectedRoute><Workflow /></ProtectedRoute>} />
              <Route path="/agents" element={<ProtectedRoute><Agents /></ProtectedRoute>} />
              <Route path="/results" element={<ProtectedRoute><Results /></ProtectedRoute>} />
              <Route path="/publish" element={<ProtectedRoute><Publish /></ProtectedRoute>} />
              <Route path="/publish/history" element={<ProtectedRoute><PublishHistory /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              
              {/* OAuth callback routes */}
              <Route path="/auth/callback/:platform" element={<ProtectedRoute><OAuthCallback /></ProtectedRoute>} />
              
              {/* Admin routes */}
              <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
              <Route path="/admin/moderation" element={<AdminRoute><AdminModeration /></AdminRoute>} />
              <Route path="/admin/analytics" element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
              <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
              <Route path="/admin/activity" element={<AdminRoute><AdminActivityLogs /></AdminRoute>} />
              <Route path="/admin/features" element={<AdminRoute><AdminFeatureToggles /></AdminRoute>} />
              <Route path="/admin/content" element={<AdminRoute><AdminContentEditor /></AdminRoute>} />
              <Route path="/admin/intro-video" element={<AdminRoute><AdminIntroVideo /></AdminRoute>} />
              
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </LanguageProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
