import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const port = process.env.PORT || 3001;
const dataDir = path.resolve(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'rahat-db.json');

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

ensureSeedUser();

app.use(cors());
app.use(express.json());

app.get('/api/v1/health', (_req, res) => {
  res.json({ ok: true, service: 'rahat-backend' });
});

app.get('/api/v1/users', (_req, res) => {
  res.json(readDb().users);
});

app.post('/api/v1/users', (req, res) => {
  const { id, email, name, role, phone, password } = req.body || {};
  if (!id || !email || !name || !role) {
    return res.status(400).json({ error: 'Missing required user data' });
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

app.get('/api/v1/requests', (_req, res) => {
  const db = readDb();
  res.json(db.requests.map((row) => ({
    ...row,
    location: { lat: row.location?.lat ?? 0, lng: row.location?.lng ?? 0, address: row.location?.address || '' },
  })));
});

app.post('/api/v1/requests', (req, res) => {
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

  const db = readDb();
  const request = {
    id,
    citizenEmail,
    citizenName,
    citizenPhone,
    peopleAffected: Number(peopleAffected || 1),
    emergencyType,
    requiredResources: requiredResources || [],
    severity: severity || 'MEDIUM',
    description: description || '',
    location: {
      lat: Number(location.lat || 0),
      lng: Number(location.lng || 0),
      address: location.address || '',
    },
    accessibilityRequirements: accessibilityRequirements || '',
    preferredContact: preferredContact || 'Phone',
    status: status || 'NEW',
    assignedVolunteerId: assignedVolunteerId || undefined,
    allocatedResources: [],
    timeline: [{ status: status || 'NEW', timestamp: new Date().toISOString(), note: 'Request submitted through the citizen portal' }],
    coordinatorNotes: coordinatorNotes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.requests = [request, ...db.requests];
  writeDb(db);
  res.status(201).json({ ok: true, id });
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

app.get('/api/v1/volunteers', (_req, res) => {
  const db = readDb();
  res.json(db.volunteers.map((row) => ({
    ...row,
    location: { lat: row.location?.lat ?? 0, lng: row.location?.lng ?? 0, address: row.location?.address || '' },
  })));
});

app.post('/api/v1/volunteers', (req, res) => {
  const body = req.body || {};
  const { id, userId, name, phone, skills, availability, location, vehicle, currentAssignmentIds, completedMissions, experienceMonths } = body;

  if (!id || !name) {
    return res.status(400).json({ error: 'Missing volunteer data' });
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
