import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.tsx";
import { LoginPage } from "./routes/login.tsx";
import { MeetingsListPage } from "./routes/meetings.tsx";
import { NewMeetingPage } from "./routes/meetings.new.tsx";
import { SetupPage } from "./routes/meeting.setup.tsx";
import { SectionsPage } from "./routes/meeting.sections.tsx";
import { SectionPage } from "./routes/meeting.section.tsx";
import { ExportPage } from "./routes/meeting.export.tsx";
import { AdminUsersPage } from "./routes/admin.users.tsx";
import { AdminTemplatesPage } from "./routes/admin.templates.tsx";
import { getAccessTokenFromStorage } from "./lib/auth.tsx";

function requireAuthLoader() {
  if (!getAccessTokenFromStorage()) {
    throw redirect({ to: "/login" });
  }
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: requireAuthLoader,
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: MeetingsListPage,
});

const newMeetingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/m/new",
  component: NewMeetingPage,
});

const setupRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/m/$id/setup",
  component: SetupPage,
});

const sectionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/m/$id/sections",
  component: SectionsPage,
});

const sectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/m/$id/section/$key",
  component: SectionPage,
});

const exportRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/m/$id/export",
  component: ExportPage,
});

const adminUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/users",
  component: AdminUsersPage,
});

const adminTemplatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/admin/templates",
  component: AdminTemplatesPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, newMeetingRoute, setupRoute, sectionsRoute, sectionRoute, exportRoute, adminUsersRoute, adminTemplatesRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
