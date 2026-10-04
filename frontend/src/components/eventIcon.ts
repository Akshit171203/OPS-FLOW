import {
  Flame,
  GitCommitHorizontal,
  MessageSquare,
  Rocket,
  Sparkles,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/** Icon for a timeline event type, shared by the dashboard feed and the incident timeline. */
export function eventIcon(eventType: string): LucideIcon {
  if (eventType.startsWith('ai.')) return Sparkles;
  if (eventType === 'incident.deployment_linked') return Rocket;
  if (eventType === 'incident.created') return Flame;
  if (eventType === 'incident.comment_added') return MessageSquare;
  if (eventType === 'incident.assigned') return UserRound;
  return GitCommitHorizontal;
}
