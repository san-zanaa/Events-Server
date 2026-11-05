import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: process.env.CLIENT_URL,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(async (req, res, next) => {
    try {
        await connectToMongoDB();
        next();
    } catch (error) {
        console.error('MongoDB Connection Error:', error);

        res.status(500).send({
            message: 'Database connection failed',
            error: error.message
        });
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!process.env.MONGODB_URL) {
  throw new Error('MONGODB_URL is missing from .env');
}

const client = new MongoClient(process.env.MONGODB_URL);

let eventsCollection;
let joinedEventsCollection;
let connectionPromise;

async function connectToMongoDB() {
    if (!connectionPromise) {
        connectionPromise = (async () => {
            await client.connect();

            const database = client.db('event-management');

            eventsCollection = database.collection('events');
            joinedEventsCollection = database.collection('joinedEvents');

            await joinedEventsCollection.createIndex(
                { userEmail: 1, eventId: 1 },
                { unique: true }
            );

            console.log('Successfully connected to MongoDB!');
        })().catch((error) => {
            connectionPromise = null;
            throw error;
        });
    }

    return connectionPromise;
}
const AUTH_BASE_URL = process.env.AUTH_BASE_URL?.replace(/\/$/, '');
if (!AUTH_BASE_URL) {
    throw new Error('AUTH_BASE_URL is missing');
}
const JWKS = createRemoteJWKSet(
    new URL(`${AUTH_BASE_URL}/api/auth/jwks`)
);

const verifyApi = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).send({
        success: false,
        message: 'Unauthorized: Token missing',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).send({
        success: false,
        message: 'Unauthorized: Invalid token',
      });
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: AUTH_BASE_URL,
      audience: AUTH_BASE_URL,
    });
    if (!payload.sub || !payload.email) {
      return res.status(401).send({
        success: false,
        message: 'Unauthorized: Invalid token payload',
      });
    }

    req.user = {
      id: payload.sub,
      email: String(payload.email).toLowerCase(),
    };

    next();
  } catch (error) {
    console.error('JWT Verification Error:', error.message);

    return res.status(401).send({
      success: false,
      message: 'Unauthorized: Token verification failed',
    });
  }
};

app.get('/events', async (req, res) => {
  try {
    const events = await eventsCollection
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    res.send(events);
  } catch (error) {
    console.error('Get Events Error:', error);

    res.status(500).send({
      message: 'Failed to get events',
    })

  }
});

app.post('/create-event', verifyApi, async (req, res) => {
  try {
    const {
      _id,
      organizerEmail,
      volunteerCount,
      createdAt,
      ...eventData
    } = req.body;

    if (!eventData.title || !eventData.date || !eventData.location) {
      return res.status(400).send({
        message: 'Title, date and location are required',
      });
    }

    const event = {
      ...eventData,
      organizerEmail: req.user.email,
      volunteerCount: 0,
      createdAt: new Date(),
    };

    const result = await eventsCollection.insertOne(event);

    res.status(201).send({
      success: true,
      message: 'Event added successfully!',
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error('Create Event Error:', error);

    res.status(500).send({
      message: 'Failed to create event',
    });
  }
})

app.post('/join-events', verifyApi, async (req, res) => {
  try {
    const { eventId } = req.body;
    const email = req.user.email;

    if (!eventId || !ObjectId.isValid(eventId)) {
      return res.status(400).send({
        message: 'Valid event ID is required',
      })
    }

    const objectEventId = new ObjectId(eventId);
    const event = await eventsCollection.findOne({
      _id: objectEventId,
    });

    if (!event) {
      return res.status(404).send({
        message: 'Event not found',
      });
    }

    const alreadyJoined = await joinedEventsCollection.findOne({
      userEmail: email,
      eventId: objectEventId,
    });

    if (alreadyJoined) {
      return res.status(409).send({
        message: 'You have already joined this event',
      })
    }

    await joinedEventsCollection.insertOne({
      userEmail: email,
      eventId: objectEventId,
      joinedAt: new Date(),
    })

    await eventsCollection.updateOne(
      { _id: objectEventId },
      { $inc: { volunteerCount: 1 } }
    );

    res.status(201).send({
      success: true,
      message: 'Successfully joined the event!',
    });
  } catch (error) {
    console.error('Join Event Error:', error);

    if (error.code === 11000) {
      return res.status(409).send({
        message: 'You have already joined this event',
      });
    }

    res.status(500).send({
      message: 'Failed to join event',
    });
  }
})

app.get('/joined-events', verifyApi, async (req, res) => {
  try {
    const email = req.user.email;
    const joinedRecords = await joinedEventsCollection
      .find({ userEmail: email })
      .sort({ joinedAt: -1 })
      .toArray();

    const eventIds = joinedRecords.map(item => item.eventId);
    const events = await eventsCollection
      .find({ _id: { $in: eventIds } })
      .toArray();

    const joinedEvents = events.map(event => {
      const joinedRecord = joinedRecords.find(
        item => item.eventId.toString() === event._id.toString()
      );

      return {
        ...event,
        joinedAt: joinedRecord?.joinedAt,
      }
    });

    res.send(joinedEvents);
  } catch (error) {
    console.error('Joined Events Error:', error);

    res.status(500).send({
      message: 'Failed to get joined events',
    });
  }
});

app.get('/my-events', verifyApi, async (req, res) => {
  try {
    const email = req.user.email;
    const events = await eventsCollection
      .find({ organizerEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(events);
  } catch (error) {
    console.error('My Events Error:', error);

    res.status(500).send({
      message: 'Failed to get your events',
    });
  }
});

app.delete('/leave-event/:id', verifyApi, async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.user.email;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: 'Invalid event ID',
      });
    }

    const eventId = new ObjectId(id);
    const result = await joinedEventsCollection.deleteOne({
      userEmail: email,
      eventId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: 'You have not joined this event',
      });
    }

    await eventsCollection.updateOne(
      {
        _id: eventId,
        volunteerCount: { $gt: 0 },
      },
      {
        $inc: { volunteerCount: -1 },
      }
    );

    res.send({
      success: true,
      message: 'Successfully left the event!',
    });
  } catch (error) {
    console.error('Leave Event Error:', error);

    res.status(500).send({
      message: 'Failed to leave event',
    });
  }
});

app.put('/update-event/:id', verifyApi, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: 'Invalid event ID',
      });
    }
    const {
      _id,
      organizerEmail,
      volunteerCount,
      createdAt,
      ...updatedData
    } = req.body;

    if (Object.keys(updatedData).length === 0) {
      return res.status(400).send({
        message: 'No update data provided',
      });
    }

    const eventId = new ObjectId(id);
    const result = await eventsCollection.updateOne(
      {
        _id: eventId,
        organizerEmail: req.user.email,
      },
      {
        $set: updatedData,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: 'Event not found or you are not allowed to update it',
      });
    }

    res.send({
      success: true,
      message: 'Event updated successfully!',
    });
  } catch (error) {
    console.error('Update Event Error:', error);

    res.status(500).send({
      message: 'Failed to update event',
    });
  }
});

app.delete('/delete-event/:id', verifyApi, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: 'Invalid event ID',
      });
    }

    const eventId = new ObjectId(id);
    const result = await eventsCollection.deleteOne({
      _id: eventId,
      organizerEmail: req.user.email,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: 'Event not found or you are not allowed to delete it',
      });
    }

    await joinedEventsCollection.deleteMany({
      eventId,
    });

    res.send({
      success: true,
      message: 'Event deleted successfully!',
    });
  } catch (error) {
    console.error('Delete Event Error:', error);

    res.status(500).send({
      message: 'Failed to delete event',
    });
  }
});

app.get('/', (req, res) => {
  res.send('Event Management API is running!');
});

async function startServer() {
    try {
        await connectToMongoDB();
        app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Server startup failed:', error);
        process.exit(1);
    }
}

if (!process.env.VERCEL) {
    startServer();
}

export default app;