import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = process.env.PORT || 3001;
const dataDir = path.resolve(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'rahat-db.json');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && (supabaseAnonKey || supabaseServiceRoleKey)
  ? createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const defaultDb = {
  users: [],
  requests: [],
  volunteers: [],
  notifications: [],
};

const readDb = () => {
  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
      return structuredClone(defaultDb);
    }

    const raw = fs.readFileSync(dbPath, 'utf8').trim();
    if (!raw) {
      fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
      return structuredClone(defaultDb);
    }

    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      volunteers: Array.isArray(parsed.volunteers) ? parsed.volunteers : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    };
  } catch {
    fs.writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
    return structuredClone(defaultDb);
  }
};

const writeDb = (nextDb) => {
  fs.writeFileSync(dbPath, JSON.stringify(nextDb, null, 2));
};

const ensureSeedUser = () => {
  const db = readDb();
  if (!db.users.some((user) => user.email === 'admin@rahat.com')) {
    db.users.push({
      id: 'u-admin',
      email: 'admin@rahat.com',
      name: 'Aditya',
      role: 'coordinator',
      phone: '',
      password: '@Aditya#8080',
      createdAt: new Date().toISOString(),
    });
    writeDb(db);
  }
};

const normalizeUserRow = (row) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  phone: row.phone || '',
  password: row.password || '',
  createdAt: row.created_at || row.createdAt || new Date().toISOString(),
});

const normalizeRequestRow = (row) => ({
  id: row.id,
  citizenEmail: row.citizen_email || row.citizenEmail,
  citizenName: row.citizen_name || row.citizenName,
  citizenPhone: row.citizen_phone || row.citizenPhone,
  peopleAffected: Number(row.people_affected ?? row.peopleAffected ?? 1),
  emergencyType: row.emergency_type || row.emergencyType,
  requiredResources: row.required_resources || row.requiredResources || [],
  severity: row.severity || 'MEDIUM',
  description: row.description || '',
  location: row.location || { lat: 0, lng: 0, address: '' },
  accessibilityRequirements: row.accessibility_requirements || row.accessibilityRequirements || '',
  preferredContact: row.preferred_contact || row.preferredContact || 'Phone',
  status: row.status || 'NEW',
  assignedVolunteerId: row.assigned_volunteer_id || row.assignedVolunteerId || undefined,
  allocatedResources: row.allocated_resources || row.allocatedResources || [],
  timeline: row.timeline || [],
  coordinatorNotes: row.coordinator_notes || row.coordinatorNotes || '',
  createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  updatedAt: row.updated_at || row.updatedAt || new Date().toISOString(),
});

const normalizeVolunteerRow = (row) => ({
  id: row.id,
  userId: row.userId || row.userid,
  name: row.name,
  phone: row.phone || '',
  skills: row.skills || [],
  availability: row.availability || 'AVAILABLE',
  location: row.location || { lat: 0, lng: 0, address: '' },
  vehicle: row.vehicle || 'None',
  currentAssignmentIds: row.current_assignment_ids || row.currentAssignmentIds || [],
  completedMissions: Number(row.completed_missions ?? row.completedMissions ?? 0),
  experienceMonths: Number(row.experience_months ?? row.experienceMonths ?? 0),
});

const listSupabase = async (table) => {
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select('*');
  if (error) return null;
  return data || [];
};

ensureSeedUser();

app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, service: 'rahat-backend' });
});

app.get('/api/v1/users', async (_req, res) => {
  if (supabase) {
    const rows = await listSupabase('users');
    if (rows) {
      return res.json(rows.map(normalizeUserRow));
    }
  }
  return res.json(readDb().users);
});

app.post('/api/v1/users', async (req, res) => {
  const { id, email, name, role, phone, password } = req.body || {};
  if (!id || !email || !name || !role) {
    return res.status(400).json({ error: 'Missing required user data' });
  }

  if (supabase) {
    const payload = {
      id,
      email,
      name,
      role,
      phone: phone || '',
      password: password || '',
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ ok: true, id });
  }

  const db = readDb();
  if (db.users.some((user) => user.email === email)) {
    return res.status(400).json({ error: 'User already exists' });
  }

  db.users.push({
    id,
    email,
    name,
    role,
    phone: phone || '',
    password: password || '',
    createdAt: new Date().toISOString(),
  });

  writeDb(db);
  res.status(201).json({ ok: true, id });
});

app.get('/api/v1/requests', async (_req, res) => {
  if (supabase) {
    const rows = await listSupabase('requests');
    if (rows) {
      return res.json(rows.map(normalizeRequestRow));
    }
  }
  const db = readDb();
  return res.json(db.requests.map((row) => ({
    ...row,
    location: { lat: row.location?.lat ?? 0, lng: row.location?.lng ?? 0, address: row.location?.address || '' },
  })));
});

app.post('/api/v1/requests', async (req, res) => {
  const body = req.body || {};
  const {
    id,
    citizenEmail,
    citizenName,
    citizenPhone,
    peopleAffected,
    emergencyType,
    requiredResources,
    severity,
    description,
    location,
    accessibilityRequirements,
    preferredContact,
    status,
    assignedVolunteerId,
    coordinatorNotes,
  } = body;

  if (!id || !citizenEmail || !emergencyType || !location) {
    return res.status(400).json({ error: 'Missing request data' });
  }

  const request = {
    id,
    citizen_email: citizenEmail,
    citizen_name: citizenName,
    citizen_phone: citizenPhone,
    people_affected: Number(peopleAffected || 1),
    emergency_type: emergencyType,
    required_resources: requiredResources || [],
    severity: severity || 'MEDIUM',
    description: description || '',
    location: {
      lat: Number(location.lat || 0),
      lng: Number(location.lng || 0),
      address: location.address || '',
    },
    accessibility_requirements: accessibilityRequirements || '',
    preferred_contact: preferredContact || 'Phone',
    status: status || 'NEW',
    assigned_volunteer_id: assignedVolunteerId || null,
    allocated_resources: [],
    timeline: [{ status: status || 'NEW', timestamp: new Date().toISOString(), note: 'Request submitted through the citizen portal' }],
    coordinator_notes: coordinatorNotes || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (supabase) {
    const { error } = await supabase.from('requests').upsert(request, { onConflict: 'id' });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ ok: true, id });
  }

  const db = readDb();
  db.requests = [{ ...normalizeRequestRow(request), ...request, location: request.location }, ...db.requests];
  writeDb(db);
  return res.status(201).json({ ok: true, id });
});

app.post('/api/v1/requests/:id/assign-volunteer', (req, res) => {
  const { volunteerId } = req.body || {};
  const db = readDb();
  const request = db.requests.find((item) => item.id === req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  request.assignedVolunteerId = volunteerId;
  request.status = 'ASSIGNED';
  request.updatedAt = new Date().toISOString();
  request.timeline.push({ status: 'ASSIGNED', timestamp: new Date().toISOString(), note: 'Volunteer assigned' });

  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/v1/volunteers', async (_req, res) => {
  if (supabase) {
    const rows = await listSupabase('volunteers');
    if (rows) {
      return res.json(rows.map(normalizeVolunteerRow));
    }
  }
  const db = readDb();
  return res.json(db.volunteers.map((row) => ({
    ...row,
    location: { lat: row.location?.lat ?? 0, lng: row.location?.lng ?? 0, address: row.location?.address || '' },
  })));
});

app.post('/api/v1/volunteers', async (req, res) => {
  const body = req.body || {};
  const { id, userId, name, phone, skills, availability, location, vehicle, currentAssignmentIds, completedMissions, experienceMonths } = body;

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing volunteer data' });
  }

  const volunteer = {
    id,
    userid: userId || null,
    name,
    phone: phone || '',
    skills: skills || [],
    availability: availability || 'AVAILABLE',
    location: {
      lat: Number(location?.lat || 0),
      lng: Number(location?.lng || 0),
      address: location?.address || '',
    },
    vehicle: vehicle || 'None',
    current_assignment_ids: currentAssignmentIds || [],
    completed_missions: Number(completedMissions || 0),
    experience_months: Number(experienceMonths || 0),
  };

  if (supabase) {
    const { error } = await supabase.from('volunteers').upsert(volunteer, { onConflict: 'id' });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ ok: true, id });
  }

  const db = readDb();
  db.volunteers.push({
    id,
    userId: userId || null,
    name,
    phone: phone || '',
    skills: skills || [],
    availability: availability || 'AVAILABLE',
    location: {
      lat: Number(location?.lat || 0),
      lng: Number(location?.lng || 0),
      address: location?.address || '',
    },
    vehicle: vehicle || 'None',
    currentAssignmentIds: currentAssignmentIds || [],
    completedMissions: Number(completedMissions || 0),
    experienceMonths: Number(experienceMonths || 0),
  });

  writeDb(db);
  res.status(201).json({ ok: true, id });
});

app.get('/api/v1/notifications', (_req, res) => {
  const db = readDb();
  res.json(db.notifications.map((row) => ({ ...row, read: !!row.read })));
});

app.post('/api/v1/notifications', (req, res) => {
  const { id, targetRole, targetUserId, type, title, message, relatedRequestId } = req.body || {};

  if (!id || !type || !title || !message) {
    return res.status(400).json({ error: 'Missing notification data' });
  }

  const db = readDb();
  db.notifications.unshift({
    id,
    targetRole: targetRole || undefined,
    targetUserId: targetUserId || undefined,
    type,
    title,
    message,
    relatedRequestId: relatedRequestId || undefined,
    read: false,
    createdAt: new Date().toISOString(),
  });

  writeDb(db);
  res.status(201).json({ ok: true, id });
});

app.listen(port, () => {
  console.log(`RAHAT backend listening on http://localhost:${port}`);
});
