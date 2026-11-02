import {
  Activity,
  BarChart3,
  CalendarClock,
  CheckSquare,
  Database,
  FileSpreadsheet,
  KanbanSquare,
  LayoutDashboard,
  Microscope,
  Search,
  Send,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Key used to look up a live count badge (approvals, follow-ups). */
  badgeKey?: "pendingApprovals" | "followUpsDue";
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    title: "Overview",
    subtitle: "Track lead generation, outreach performance, and sales pipeline in real time.",
    icon: LayoutDashboard,
  },
  {
    href: "/discovery",
    label: "Lead Discovery",
    title: "Lead Discovery",
    subtitle: "Launch and monitor discovery runs from authorized data sources.",
    icon: Search,
  },
  {
    href: "/leads",
    label: "Lead Database",
    title: "Lead Database",
    subtitle: "Search, filter, and review every company and prospect.",
    icon: Database,
  },
  {
    href: "/research",
    label: "Company Research",
    title: "Company Research",
    subtitle: "Company profiles, research history and evidence for every lead.",
    icon: Microscope,
  },
  {
    href: "/imports",
    label: "Excel Imports",
    title: "Excel Imports",
    subtitle: "Upload Excel and CSV files, map columns, and review import results.",
    icon: FileSpreadsheet,
  },
  {
    href: "/approvals",
    label: "Approval Queue",
    title: "Approval Queue",
    subtitle: "Review, edit, and approve every message before it is sent.",
    icon: CheckSquare,
    badgeKey: "pendingApprovals",
  },
  {
    href: "/outreach",
    label: "Outreach",
    title: "Outreach",
    subtitle: "Manage campaigns and track every outreach attempt and reply.",
    icon: Send,
  },
  {
    href: "/follow-ups",
    label: "Follow-ups",
    title: "Follow-ups",
    subtitle: "Due, overdue, and upcoming follow-up tasks.",
    icon: CalendarClock,
    badgeKey: "followUpsDue",
  },
  {
    href: "/pipeline",
    label: "Sales Pipeline",
    title: "Sales Pipeline",
    subtitle: "Opportunities by stage, pipeline value, and won deals.",
    icon: KanbanSquare,
  },
  {
    href: "/reports",
    label: "Reports",
    title: "Reports & Analytics",
    subtitle: "Filtered reports with explicit metric definitions and CSV export.",
    icon: BarChart3,
  },
  {
    href: "/automation",
    label: "Automation Logs",
    title: "Automation Logs",
    subtitle: "Workflow runs, outcomes, and errors.",
    icon: Activity,
  },
  {
    href: "/settings",
    label: "Settings",
    title: "Settings",
    subtitle: "Workspace preferences, provider status, and access.",
    icon: Settings,
  },
];

export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV_ITEMS[0];
  return NAV_ITEMS.find((item) => item.href !== "/" && pathname.startsWith(item.href));
}

export function isNavItemActive(item: NavItem, pathname: string) {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}
