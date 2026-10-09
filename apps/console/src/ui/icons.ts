/**
 * Every glyph the console draws, and the only module allowed to import the icon set (ESLint
 * `no-restricted-imports`), so swapping Lucide for another set changes this file alone.
 * Glyph choices follow the approved icon map in `docs/design/icons.md`.
 *
 * To add a glyph: import it here, then either map it to a domain value below or re-export it with
 * the generic UI glyphs at the bottom.
 */
import {
  Building2,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Cpu,
  DoorOpen,
  Fence,
  Flag,
  Flame,
  HeartPulse,
  Info,
  type LucideIcon,
  OctagonAlert,
  Package,
  Radio,
  RefreshCw,
  SquareParking,
  Trees,
  TriangleAlert,
  User,
  UserCheck,
  Users,
  Video,
  VideoOff,
  WifiOff,
  Wrench,
} from 'lucide-react';
import type {
  ActorKind,
  IncidentEventKind,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  ZoneKind,
} from '@occ/contracts';
import type { ConnectionState } from '../store';

/** A drawable glyph. Consumers use this type, never the icon set's own. */
export type Glyph = LucideIcon;

// Each map is a `Record` over its union, so a value added to the contract fails `typecheck` here
// until it has a glyph.

const SEVERITY_ICONS: Record<IncidentSeverity, Glyph> = {
  critical: OctagonAlert,
  high: TriangleAlert,
  medium: CircleAlert,
  low: Info,
};

export const severityIcon = (severity: IncidentSeverity) => SEVERITY_ICONS[severity];

const INCIDENT_TYPE_ICONS: Record<IncidentType, Glyph> = {
  intrusion: DoorOpen,
  fire_alarm: Flame,
  equipment_fault: Wrench,
  medical: HeartPulse,
  crowding: Users,
  suspicious_object: Package,
};

export const incidentTypeIcon = (type: IncidentType) => INCIDENT_TYPE_ICONS[type];

const STATUS_ICONS: Record<IncidentStatus, Glyph> = {
  open: CircleDot,
  acknowledged: UserCheck,
  resolved: CircleCheck,
};

export const statusIcon = (status: IncidentStatus) => STATUS_ICONS[status];

// Acknowledged and resolved share their status glyph: the timeline entry means the same thing.
const EVENT_KIND_ICONS: Record<IncidentEventKind, Glyph> = {
  reported: Flag,
  acknowledged: UserCheck,
  resolved: CircleCheck,
};

export const eventKindIcon = (kind: IncidentEventKind) => EVENT_KIND_ICONS[kind];

const ZONE_KIND_ICONS: Record<ZoneKind, Glyph> = {
  building: Building2,
  parking: SquareParking,
  gate: Fence,
  outdoor: Trees,
};

export const zoneKindIcon = (kind: ZoneKind) => ZONE_KIND_ICONS[kind];

const ACTOR_KIND_ICONS: Record<ActorKind, Glyph> = {
  user: User,
  system: Cpu,
};

export const actorKindIcon = (kind: ActorKind) => ACTOR_KIND_ICONS[kind];

// The first connect and a reconnect attempt share the refresh glyph: both are a link being made.
const CONNECTION_ICONS: Record<ConnectionState, Glyph> = {
  live: Radio,
  connecting: RefreshCw,
  reconnecting: RefreshCw,
  offline: WifiOff,
};

export const connectionIcon = (state: ConnectionState) => CONNECTION_ICONS[state];

export const cameraIcon = (online: boolean): Glyph => (online ? Video : VideoOff);

// Generic UI glyphs, re-exported so that nothing outside this module imports the icon set.
// The map glyph is Lucide's `MapIcon` alias, so it does not shadow the global `Map` in consumers.
export {
  Activity,
  Box,
  Check,
  ChevronDown,
  CircleX,
  Clock,
  Crosshair,
  Eye,
  Fan,
  House,
  Info,
  Keyboard,
  LoaderCircle,
  Lock,
  LogOut,
  MapIcon,
  MapPin,
  Maximize,
  Maximize2,
  Minus,
  Pause,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  RotateCw,
  Rows3,
  Scan,
  Search,
  Shield,
  Thermometer,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
