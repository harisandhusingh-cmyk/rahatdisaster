import { create } from 'zustand';
import * as idbKeyval from 'idb-keyval';
import { clearAppState, loadAppState, saveAppState } from '../utils/database';

import type {
  Allocation,
  AuditLogEntry,
  EmergencyRequest,
  GeoCoords,
  Incident,
  IncidentNote,
  Notification,
  RequestStatus,
  ResourceInventory,
  Role,
  Shelter,
  TimelineEntry,
  UserProfile,
  Volunteer,
  VolunteerAvailability,
  ReliefCenter,
  Severity,
} from '../types/rahat';

export type UiDensity = 'comfortable' | 'compact';
import { STATUS_TRANSITION_GRAPH } from '../constants/rahat';
import { generateRequestId, generateIncidentId, generateUUID } from '../utils/ids';

export type RahatSlice = {
  initialized: boolean;
  users: UserProfile[];
  requests: EmergencyRequest[];
  volunteers: Volunteer[];
  resources: ResourceInventory[];
  allocations: Allocation[];
  shelters: Shelter[];
  reliefCenters: ReliefCenter[];
  incidents: Incident[];
  notifications: Notification[];
  auditLog: AuditLogEntry[];
  requestCounter: number;
  incidentCounter: number;
  currentUserId: string | null;
  offlineBannerDismissed: boolean;
  backendOnline: boolean;
};

type ActorCtx = { actorId: string | null; actorName: string; role?: Role };

export type RahatActions = {
  initialize: () => Promise<void>;
  resetDemoData: () => Promise<void>;
  setBackendOnline: (online: boolean) => void;
  dismissOfflineBanner: () => void;
  setCurrentUser: (userId: string | null) => Promise<void>;
  getCurrentUser: () => UserProfile | null;
  findUserByEmail: (email: string) => UserProfile | null;
  createAccount: (input: { name: string; email: string; phone: string; password: string; role: 'citizen' | 'volunteer' }) => { ok: boolean; error?: string; userId?: string };
  deleteRequest: (requestId: string, ctx: ActorCtx) => { ok: boolean; error?: string };
  createResource: (input: Pick<ResourceInventory, 'name' | 'category' | 'quantity' | 'unit' | 'storageLocation' | 'lowThreshold'>) => ResourceInventory;
  createIncident: (input: Pick<Incident, 'name' | 'type' | 'affectedArea' | 'severity' | 'description' | 'status'>) => Incident;
  createShelter: (input: Pick<Shelter, 'name' | 'address' | 'capacity' | 'foodAvailable' | 'waterAvailable' | 'medicalAvailable' | 'status'> & { location: GeoCoords }) => Shelter;
  updateUserProfile: (userId: string, updates: Pick<UserProfile, 'name' | 'phone'>) => { ok: boolean; error?: string };
  updateVolunteerLocation: (volunteerId: string, location: GeoCoords) => { ok: boolean; error?: string };
  refreshFromStorage: () => Promise<void>;
  createVolunteerProfile: (input: { name: string; email: string; phone: string; skills: Volunteer['skills']; vehicle: NonNullable<Volunteer['vehicle']> }) => { ok: boolean; error?: string; volunteerId?: string };
  createEmergencyRequest: (input: {
    citizenEmail: string;
    citizenName: string;
    citizenPhone: string;
    peopleAffected: number;
    emergencyType: EmergencyRequest['emergencyType'];
    requiredResources: EmergencyRequest['requiredResources'];
    severity: Severity;
    description: string;
    location: GeoCoords;
    accessibilityRequirements?: string;
    preferredContact?: EmergencyRequest['preferredContact'];
  }) => EmergencyRequest;
  updateRequestStatus: (requestId: string, status: RequestStatus, ctx: ActorCtx) => { ok: boolean; error?: string };

  assignVolunteerToRequest: (requestId: string, volunteerId: string, ctx: ActorCtx) => { ok: boolean; error?: string };
  allocateResourcesToRequest: (
    requestId: string,
    items: Array<{ resourceId: string; quantity: number }>,
    ctx: ActorCtx
  ) => { ok: boolean; error?: string; allocations?: Allocation[] };

  createNotification: (payload: {
    targetRole?: Role;
    targetUserId?: string;
    type: string;
    title: string;
    message: string;
    relatedRequestId?: string;
  }) => Notification;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: (roleOrUserId: Role | string) => void;

  appendAuditLog: (entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string }) => AuditLogEntry;
};

export type RahatStore = RahatSlice & RahatActions;

const STORAGE_KEY = 'rahat-store-v1';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const PERSIST_KEYS: Array<keyof RahatSlice> = [
  'users',
  'requests',
  'volunteers',
  'resources',
  'allocations',
  'shelters',
  'reliefCenters',
  'incidents',
  'notifications',
  'auditLog',
  'requestCounter',
  'incidentCounter',
  'currentUserId',
  'offlineBannerDismissed',
];

async function persist(state: RahatSlice): Promise<void> {
  const snapshot: Partial<RahatSlice> = {};
  for (const k of PERSIST_KEYS) snapshot[k] = state[k] as any;

  try {
    await saveAppState(snapshot);
  } catch {
    /* ignore */
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent('rahat-store-updated'));
  } catch {
    /* ignore */
  }

  try {
    await idbKeyval.set(STORAGE_KEY, snapshot);
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore */
    }
  }
}

async function hydrate(): Promise<Partial<RahatSlice> | null> {
  try {
    const fromDb = await loadAppState();
    if (fromDb && fromDb.users && Array.isArray(fromDb.users) && fromDb.users.length > 0) return fromDb;
  } catch {
    /* fallthrough */
  }

  try {
    const fromIdb = (await idbKeyval.get(STORAGE_KEY)) as Partial<RahatSlice> | undefined;
    if (fromIdb && fromIdb.users && fromIdb.users.length > 0) return fromIdb;
  } catch {
    /* fallthrough */
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Partial<RahatSlice>;
  } catch {
    /* ignore */
  }
  return null;
}

async function clearStorage(): Promise<void> {
  try {
    await clearAppState();
  } catch {
    /* ignore */
  }
  try {
    await idbKeyval.del(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

async function syncRemoteState(): Promise<Partial<RahatSlice> | null> {
  try {
    const [usersRes, requestsRes, volunteersRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/users`),
      fetch(`${API_BASE_URL}/api/v1/requests`),
      fetch(`${API_BASE_URL}/api/v1/volunteers`),
    ]);

    if (!usersRes.ok && !requestsRes.ok && !volunteersRes.ok) {
      return null;
    }

    const users = usersRes.ok ? await usersRes.json() : [];
    const requests = requestsRes.ok ? await requestsRes.json() : [];
    const volunteers = volunteersRes.ok ? await volunteersRes.json() : [];

    return {
      initialized: true,
      backendOnline: true,
      users: Array.isArray(users) ? users : [],
      requests: Array.isArray(requests) ? requests : [],
      volunteers: Array.isArray(volunteers) ? volunteers : [],
    };
  } catch {
    return null;
  }
}

function emptyState(): RahatSlice {
  return {
    initialized: true,
    users: [{ id: 'u-admin', email: 'admin@rahat.com', name: 'Aditya', role: 'coordinator', phone: '', password: '@Aditya#8080', createdAt: nowISO() }],
    requests: [],
    volunteers: [],
    resources: [],
    allocations: [],
    shelters: [],
    reliefCenters: [],
    incidents: [],
    notifications: [],
    auditLog: [],
    requestCounter: 0,
    incidentCounter: 0,
    currentUserId: null,
    offlineBannerDismissed: false,
    backendOnline: true,
  };
}

const nowISO = () => new Date().toISOString();

function getInventoryStatus(res: ResourceInventory): 'Available' | 'Low' | 'Out of Stock' {
  if (res.quantity <= 0) return 'Out of Stock';
  if (res.quantity <= res.lowThreshold) return 'Low';
  return 'Available';
}

export const useRahatStore = create<RahatStore>((set, get) => ({
  initialized: false,
  users: [],
  requests: [],
  volunteers: [],
  resources: [],
  allocations: [],
  shelters: [],
  reliefCenters: [],
  incidents: [],
  notifications: [],
  auditLog: [],
  requestCounter: 0,
  incidentCounter: 0,
  currentUserId: null,
  offlineBannerDismissed: false,
  backendOnline: true,

  initialize: async () => {
    if (get().initialized) return;

    const remote = await syncRemoteState();
    if (remote && Array.isArray(remote.users) && remote.users.length > 0) {
      set((s) => ({ ...s, ...remote, initialized: true, backendOnline: true }));
      await persist(get());
      return;
    }

    const hydrated = await hydrate();
    if (hydrated) {
      const hasLegacyDemo = hydrated.users?.some((user) => user.email.endsWith('@rahat.demo'));
      if (hasLegacyDemo || !hydrated.users?.some((user) => user.email === 'admin@rahat.com')) {
        const base = emptyState();
        base.auditLog = [{ id: generateUUID(), actor: 'system', action: 'MIGRATE_WORKSPACE', entityType: 'SYSTEM', entityId: 'workspace', note: 'Removed legacy demo data', timestamp: nowISO() }];
        set(base);
        await persist(get());
      } else {
        set((s) => ({ ...s, ...(hydrated as any), initialized: true, backendOnline: true }));
      }
    } else {
      const base = emptyState();
      base.auditLog = [
        {
          id: generateUUID(),
          actor: 'system',
          action: 'INIT_WORKSPACE',
          entityType: 'SYSTEM',
          entityId: 'workspace',
          note: 'Initialized live Rahat workspace',
          timestamp: nowISO(),
        },
      ];
      set(base);
      await persist(get());
    }
  },

  resetDemoData: async () => {
    await clearStorage();
    const base = emptyState();
    base.auditLog = [
      {
        id: generateUUID(),
        actor: 'system',
        action: 'RESET_WORKSPACE',
        entityType: 'SYSTEM',
        entityId: 'reset',
        note: 'Workspace reset',
        timestamp: nowISO(),
      },
    ];
    set(base);
    await persist(get());
  },

  setBackendOnline: (online) => set({ backendOnline: online }),
  dismissOfflineBanner: () => set({ offlineBannerDismissed: true }),

  setCurrentUser: async (userId) => {
    set({ currentUserId: userId });
    if (userId) {
      try {
        localStorage.setItem('rahat_current_user_id', userId);
      } catch {
        /* ignore */
      }
    } else {
      try {
        localStorage.removeItem('rahat_current_user_id');
      } catch {
        /* ignore */
      }
    }
    await persist(get());
  },

  getCurrentUser: () => {
    const state = get();
    if (!state.currentUserId) return null;
    return state.users.find((u) => u.id === state.currentUserId) || null;
  },

  findUserByEmail: (email) => {
    const lower = email.toLowerCase();
    return get().users.find((u) => u.email.toLowerCase() === lower) || null;
  },

  createAccount: (input) => {
    const email = input.email.trim().toLowerCase();
    if (input.name.trim().length < 2 || !email.includes('@') || input.password.length < 8) return { ok: false, error: 'Enter a valid name, email, and password of at least 8 characters.' };
    if (get().users.some((user) => user.email.toLowerCase() === email)) return { ok: false, error: 'An account with this email already exists.' };
    const userId = generateUUID();
    const user: UserProfile = { id: userId, email, name: input.name.trim(), role: input.role, phone: input.phone.trim(), password: input.password, createdAt: nowISO() };
    set((s) => ({ ...s, users: [...s.users, user] }));
    if (input.role === 'volunteer') {
      set((s) => ({ ...s, volunteers: [...s.volunteers, { id: generateUUID(), userId, name: user.name, phone: user.phone || '', skills: ['Communication'], availability: 'AVAILABLE', location: { lat: 26.98, lng: 84.5, address: 'Location not shared yet' }, vehicle: 'None', currentAssignmentIds: [], completedMissions: 0, experienceMonths: 0 }] }));
    }

    void fetch(`${API_BASE_URL}/api/v1/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: userId,
        email,
        name: input.name.trim(),
        role: input.role,
        phone: input.phone.trim(),
        password: input.password,
      }),
    }).catch(() => undefined);

    persist(get());
    return { ok: true, userId };
  },

  deleteRequest: (requestId, ctx) => {
    const request = get().requests.find((item) => item.id === requestId);
    if (!request) return { ok: false, error: 'Request not found.' };
    set((s) => ({
      ...s,
      requests: s.requests.filter((item) => item.id !== requestId),
      allocations: s.allocations.filter((allocation) => allocation.requestId !== requestId),
      volunteers: s.volunteers.map((volunteer) => ({ ...volunteer, currentAssignmentIds: volunteer.currentAssignmentIds.filter((id) => id !== requestId) })),
    }));
    get().appendAuditLog({ actor: ctx.actorId || ctx.actorName, action: 'DELETE_REQUEST', entityType: 'REQUEST', entityId: requestId, note: `Deleted request ${requestId}` });
    persist(get());
    return { ok: true };
  },

  createResource: (input) => {
    const resource: ResourceInventory = { id: generateUUID(), ...input, lastUpdated: nowISO() };
    set((s) => ({ ...s, resources: [resource, ...s.resources] }));
    persist(get());
    return resource;
  },

  createIncident: (input) => {
    const incident: Incident = { id: generateIncidentId(new Date().getFullYear(), get().incidentCounter + 1), ...input, startTime: nowISO(), operationalNotes: [] };
    set((s) => ({ ...s, incidents: [incident, ...s.incidents], incidentCounter: s.incidentCounter + 1 }));
    persist(get());
    return incident;
  },

  createShelter: (input) => {
    const shelter: Shelter = { id: generateUUID(), ...input, occupied: 0 };
    set((s) => ({ ...s, shelters: [shelter, ...s.shelters] }));
    persist(get());
    return shelter;
  },

  updateUserProfile: (userId, updates) => {
    const name = updates.name.trim();
    if (name.length < 2) return { ok: false, error: 'Name must be at least 2 characters.' };
    set((s) => ({
      ...s,
      users: s.users.map((user) => user.id === userId ? { ...user, name, phone: updates.phone?.trim() || undefined } : user),
      volunteers: s.volunteers.map((volunteer) => volunteer.userId === userId ? { ...volunteer, name, phone: updates.phone?.trim() || '' } : volunteer),
    }));
    get().appendAuditLog({ actor: userId, action: 'UPDATE_PROFILE', entityType: 'USER', entityId: userId, note: 'Profile details updated' });
    persist(get());
    return { ok: true };
  },

  updateVolunteerLocation: (volunteerId, location) => {
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      return { ok: false, error: 'Invalid location coordinates.' };
    }
    set((s) => ({
      ...s,
      volunteers: s.volunteers.map((volunteer) => volunteer.id === volunteerId ? { ...volunteer, location } : volunteer),
    }));
    persist(get());
    return { ok: true };
  },

  refreshFromStorage: async () => {
    let hydrated: Partial<RahatSlice> | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) hydrated = JSON.parse(raw) as Partial<RahatSlice>;
    } catch {
      hydrated = null;
    }
    if (!hydrated) hydrated = await hydrate();
    if (hydrated) {
      const { currentUserId: _ignoredCurrentUserId, ...sharedState } = hydrated as Partial<RahatSlice>;
      set((s) => ({ ...s, ...sharedState, initialized: true }));
    }
  },

  createVolunteerProfile: (input) => {
    const state = get();
    if (state.users.some((user) => user.email.toLowerCase() === input.email.trim().toLowerCase())) {
      return { ok: false, error: 'A user with this email already exists.' };
    }
    if (input.name.trim().length < 2 || !input.email.includes('@')) return { ok: false, error: 'Enter a valid name and email.' };
    const userId = generateUUID();
    const volunteerId = generateUUID();
    const ts = nowISO();
    const user: UserProfile = { id: userId, email: input.email.trim().toLowerCase(), name: input.name.trim(), role: 'volunteer', phone: input.phone.trim(), createdAt: ts };
    const volunteer: Volunteer = { id: volunteerId, userId, name: user.name, phone: user.phone || '', skills: input.skills, availability: 'AVAILABLE', location: { lat: 26.98, lng: 84.5, address: 'West Champaran District, Bihar, India' }, vehicle: input.vehicle, currentAssignmentIds: [], completedMissions: 0, experienceMonths: 0 };
    set((s) => ({ ...s, users: [...s.users, user], volunteers: [...s.volunteers, volunteer] }));
    void fetch(`${API_BASE_URL}/api/v1/volunteers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: volunteerId,
        userId,
        name: input.name.trim(),
        phone: input.phone.trim(),
        skills: input.skills,
        availability: 'AVAILABLE',
        location: { lat: 26.98, lng: 84.5, address: 'West Champaran District, Bihar, India' },
        vehicle: input.vehicle,
        currentAssignmentIds: [],
        completedMissions: 0,
        experienceMonths: 0,
      }),
    }).catch(() => undefined);
    get().appendAuditLog({ actor: state.currentUserId || 'system', action: 'CREATE_VOLUNTEER', entityType: 'VOLUNTEER', entityId: volunteerId, note: `Created volunteer profile for ${user.name}` });
    persist(get());
    return { ok: true, volunteerId };
  },

  createEmergencyRequest: (input) => {
    const state = get();
    const ts = nowISO();
    const nextCounter = state.requestCounter + 1;
    const request: EmergencyRequest = {
      id: generateRequestId(new Date().getFullYear(), nextCounter),
      ...input,
      status: 'NEW',
      allocatedResources: [],
      timeline: [{ status: 'NEW', timestamp: ts, actor: input.citizenName, note: 'Request submitted through the citizen portal' }],
      coordinatorNotes: '',
      createdAt: ts,
      updatedAt: ts,
    };
    set((s) => ({ ...s, requests: [request, ...s.requests], requestCounter: nextCounter }));
    void fetch(`${API_BASE_URL}/api/v1/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }).catch(() => undefined);
    get().createNotification({
      targetRole: 'coordinator',
      type: 'NEW_REQUEST',
      title: `New ${request.severity.toLowerCase()} request: ${request.id}`,
      message: `${request.emergencyType} reported by ${request.citizenName} at ${request.location.address}`,
      relatedRequestId: request.id,
    });
    get().appendAuditLog({
      actor: input.citizenEmail,
      action: 'CREATE_REQUEST',
      entityType: 'REQUEST',
      entityId: request.id,
      note: 'Citizen submitted an emergency request',
      afterSnapshot: request,
    });
    persist(get());
    return request;
  },

  updateRequestStatus: (requestId, status, ctx) => {
    const request = get().requests.find((item) => item.id === requestId);
    if (!request) return { ok: false, error: 'Request not found' };
    if (request.status !== status && !STATUS_TRANSITION_GRAPH[request.status].includes(status)) {
      return { ok: false, error: `Cannot move request from ${request.status} to ${status}` };
    }
    const ts = nowISO();
    const updatedRequest: EmergencyRequest = {
      ...request,
      status,
      timeline: [...request.timeline, { status, timestamp: ts, actor: ctx.actorName, note: `Status updated to ${status}` }],
      updatedAt: ts,
    };
    set((s) => ({
      ...s,
      requests: s.requests.map((item) => (item.id === requestId ? updatedRequest : item)),
      volunteers: s.volunteers.map((volunteer) => volunteer.id === request.assignedVolunteerId && ['RESOLVED', 'CANCELLED', 'DELIVERED'].includes(status)
        ? { ...volunteer, availability: 'AVAILABLE', completedMissions: status === 'RESOLVED' ? volunteer.completedMissions + 1 : volunteer.completedMissions, currentAssignmentIds: volunteer.currentAssignmentIds.filter((id) => id !== requestId) }
        : volunteer),
    }));
    if (request.citizenEmail) {
      const citizen = get().findUserByEmail(request.citizenEmail);
      if (citizen) {
        get().createNotification({
          targetUserId: citizen.id,
          type: 'REQUEST_STATUS',
          title: `Request ${request.id} is now ${status.replace('_', ' ')}`,
          message: 'Your relief request has a new status update.',
          relatedRequestId: request.id,
        });
      }
    }
    get().appendAuditLog({ actor: ctx.actorId || ctx.actorName, action: 'UPDATE_REQUEST_STATUS', entityType: 'REQUEST', entityId: requestId, beforeSnapshot: request, afterSnapshot: updatedRequest });
    persist(get());
    return { ok: true };
  },

  assignVolunteerToRequest: (requestId, volunteerId, ctx) => {
    const req = get().requests.find((r) => r.id === requestId);
    const vol = get().volunteers.find((v) => v.id === volunteerId);
    if (!req) return { ok: false, error: 'Request not found' };
    if (!vol) return { ok: false, error: 'Volunteer not found' };
    const beforeReq = JSON.parse(JSON.stringify(req));
    const beforeVol = JSON.parse(JSON.stringify(vol));
    const ts = nowISO();
    const updatedVol: Volunteer = {
      ...vol,
      availability: 'BUSY',
      currentAssignmentIds: vol.currentAssignmentIds.includes(requestId)
        ? vol.currentAssignmentIds
        : [...vol.currentAssignmentIds, requestId],
    };
    const nextStatus: RequestStatus = req.status === 'NEW' || req.status === 'UNDER_REVIEW' ? 'ASSIGNED' : req.status;
    const updatedReq: EmergencyRequest = {
      ...req,
      assignedVolunteerId: volunteerId,
      status: nextStatus,
      timeline: [
        ...req.timeline,
        { status: nextStatus, timestamp: ts, actor: ctx.actorName, note: `Volunteer assigned: ${vol.name}` },
      ],
      updatedAt: ts,
    };
    void fetch(`${API_BASE_URL}/api/v1/requests/${requestId}/assign-volunteer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volunteerId }),
    }).catch(() => undefined);
    set((s) => ({
      ...s,
      volunteers: s.volunteers.map((v) => (v.id === volunteerId ? updatedVol : v)),
      requests: s.requests.map((r) => (r.id === requestId ? updatedReq : r)),
    }));
    get().createNotification({
      targetUserId: volunteerId,
      type: 'NEW_MISSION',
      title: `New mission assigned: ${requestId}`,
      message: `${req.emergencyType} • ${req.severity} • ${req.location.address}`,
      relatedRequestId: requestId,
    });
    get().appendAuditLog({
      actor: ctx.actorId || ctx.actorName,
      action: 'ASSIGN_VOLUNTEER',
      entityType: 'REQUEST',
      entityId: requestId,
      note: `Assigned volunteer ${vol.name} (${volunteerId})`,
      beforeSnapshot: { request: beforeReq, volunteer: beforeVol },
      afterSnapshot: { request: JSON.parse(JSON.stringify(updatedReq)), volunteer: JSON.parse(JSON.stringify(updatedVol)) },
    });
    persist(get());
    return { ok: true };
  },

  allocateResourcesToRequest: (requestId, items, ctx) => {
    const state = get();
    const req = state.requests.find((r) => r.id === requestId);
    if (!req) return { ok: false, error: 'Request not found' };
    const beforeReq = JSON.parse(JSON.stringify(req));
    const beforeResources = state.resources.map((r) => JSON.parse(JSON.stringify(r)));
    const updatedResources = [...state.resources];
    const newAllocations: Allocation[] = [];
    const ts = nowISO();
    let totalQtyNote: string[] = [];
    for (const it of items) {
      const idx = updatedResources.findIndex((r) => r.id === it.resourceId);
      if (idx === -1) return { ok: false, error: `Resource not found: ${it.resourceId}` };
      const res = updatedResources[idx];
      if (it.quantity > res.quantity) {
        return { ok: false, error: `Cannot allocate ${it.quantity} ${res.unit} of ${res.name}; only ${res.quantity} available` };
      }
      const newQty = res.quantity - it.quantity;
      const newRes: ResourceInventory = { ...res, quantity: newQty, lastUpdated: ts };
      updatedResources[idx] = newRes;
      const allocation: Allocation = {
        id: generateUUID(),
        requestId,
        resourceId: res.id,
        quantity: it.quantity,
        allocatedBy: ctx.actorId || ctx.actorName,
        allocatedAt: ts,
      };
      newAllocations.push(allocation);
      totalQtyNote.push(`${res.name} ${it.quantity}${res.unit}`);
    }
    const updatedAllocations = [...state.allocations, ...newAllocations];
    const reqAllocIds = [...(req.allocatedResources.map((a) => a.id) || []), ...newAllocations.map((a) => a.id)];
    const updatedReq: EmergencyRequest = {
      ...req,
      allocatedResources: reqAllocIds
        .map((id) => updatedAllocations.find((a) => a.id === id)!)
        .filter(Boolean),
      timeline: [
        ...req.timeline,
        { status: req.status, timestamp: ts, actor: ctx.actorName, note: `Resources allocated: ${totalQtyNote.join(', ')}` },
      ],
      updatedAt: ts,
    };
    set((s) => ({
      ...s,
      resources: updatedResources,
      allocations: updatedAllocations,
      requests: s.requests.map((r) => (r.id === requestId ? updatedReq : r)),
    }));
    if (req.assignedVolunteerId) {
      get().createNotification({
        targetUserId: req.assignedVolunteerId,
        type: 'RESOURCES_ALLOCATED',
        title: `Resources allocated for ${requestId}`,
        message: totalQtyNote.join(', '),
        relatedRequestId: requestId,
      });
    }
    get().appendAuditLog({
      actor: ctx.actorId || ctx.actorName,
      action: 'ALLOCATE_RESOURCES',
      entityType: 'REQUEST',
      entityId: requestId,
      note: totalQtyNote.join(', '),
      beforeSnapshot: { request: beforeReq, resources: beforeResources },
      afterSnapshot: { request: JSON.parse(JSON.stringify(updatedReq)), resources: updatedResources.map((r) => JSON.parse(JSON.stringify(r))) },
    });
    persist(get());
    return { ok: true, allocations: newAllocations };
  },

  createNotification: (payload) => {
    const n: Notification = {
      id: generateUUID(),
      targetRole: payload.targetRole,
      targetUserId: payload.targetUserId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      relatedRequestId: payload.relatedRequestId,
      read: false,
      createdAt: nowISO(),
    };
    set((s) => ({ ...s, notifications: [n, ...s.notifications] }));
    persist(get());
    return n;
  },

  markNotificationRead: (id) => {
    set((s) => ({
      ...s,
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
    persist(get());
  },

  markAllNotificationsRead: (roleOrUserId) => {
    set((s) => ({
      ...s,
      notifications: s.notifications.map((n) => {
        const match =
          (n.targetRole && n.targetRole === (roleOrUserId as Role)) ||
          (n.targetUserId && n.targetUserId === roleOrUserId);
        return match ? { ...n, read: true } : n;
      }),
    }));
    persist(get());
  },

  appendAuditLog: (entry) => {
    const ts = entry.timestamp || nowISO();
    const e: AuditLogEntry = { id: generateUUID(), timestamp: ts, ...entry };
    set((s) => ({ ...s, auditLog: [e, ...s.auditLog] }));
    return e;
  },
}));

export function useCurrentUser(): UserProfile | null {
  return useRahatStore((s) => (s.currentUserId ? s.users.find((u) => u.id === s.currentUserId) || null : null));
}

export function useIsAdmin(): boolean {
  const u = useCurrentUser();
  return !!u && u.role === 'coordinator';
}

export function useInventoryStatusOf(resourceId: string): ReturnType<typeof getInventoryStatus> {
  const r = useRahatStore((s) => s.resources.find((x) => x.id === resourceId));
  return r ? getInventoryStatus(r) : 'Available';
}

export { getInventoryStatus };
