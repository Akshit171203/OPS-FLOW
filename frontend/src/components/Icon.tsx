import {
  AlertTriangle,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  LayoutDashboard,
  Menu,
  Plug,
  RefreshCw,
  Server,
  X,
  type LucideIcon,
} from 'lucide-react';

// Same names the pages already use, now drawn by lucide.
const icons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  incidents: AlertTriangle,
  services: Server,
  runbooks: BookOpen,
  plug: Plug,
  copy: Copy,
  check: Check,
  menu: Menu,
  close: X,
  bell: Bell,
  refresh: RefreshCw,
  chevron: ChevronDown,
};

export function Icon({
  name,
  className = 'h-[18px] w-[18px]',
}: {
  name: keyof typeof icons | string;
  className?: string;
}) {
  const Cmp = icons[name];
  return Cmp ? <Cmp className={className} strokeWidth={1.9} aria-hidden="true" /> : null;
}
