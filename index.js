import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';


const app = express();
const port = 5000;

app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const client = new MongoClient(process.env.MONGODB_URL);

let eventsCollection;
let joinedEventsCollection;

async function connectToMongoDB() {
  try {
    await client.connect();
    const database = client.db('event-management');

    eventsCollection = database.collection('events');
    joinedEventsCollection = database.collection('joinedEvents');

    await joinedEventsCollection.createIndex(
      { userEmail: 1, eventId: 1 },
      { unique: true }
    );
    console.log('Successfully connected to MongoDB!');
  } catch (err) {
    console.error(err);
    throw err;
  }
}
app.post('/create-event', async (req, res) => {
  try {
    const event = req.body;
    const result = await eventsCollection.insertOne(event);

    res.send({
      message: 'Event added successfully!',
      insertedId: result.insertedId
    });

  } catch (err) {
    console.error(err);
    res.status(500).send({
      message: 'Something went wrong'
    });
  }
});

app.get('/events', async (req, res) => {
  try {
    const events = await eventsCollection.find().toArray();
    res.send(events);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get events' });
  }
});


app.post('/join-event', async (req, res) => {
  try {
    const { eventId, userEmail } = req.body;

    if (!eventId || !ObjectId.isValid(eventId) || !userEmail) {
      return res.status(400).send({
        message: 'Valid event ID and user email are required'
      });
    }

    const email = userEmail.trim().toLowerCase();
    const objectEventId = new ObjectId(eventId);

    const event = await eventsCollection.findOne({
      _id: objectEventId
    });

    if (!event) {
      return res.status(404).send({
        message: 'Event not found'
      });
    }

    const alreadyJoined = await joinedEventsCollection.findOne({
      userEmail: email,
      eventId: objectEventId
    });

    if (alreadyJoined) {
      return res.status(409).send({
        message: 'You have already joined this event'
      });
    }

    await joinedEventsCollection.insertOne({
      userEmail: email,
      eventId: objectEventId,
      joinedAt: new Date()
    });

    await eventsCollection.updateOne(
      { _id: objectEventId },
      { $inc: { volunteerCount: 1 } }
    );

    res.status(201).send({
      message: 'Successfully joined the event!'
    });

  } catch (err) {
    console.error(err);

    if (err.code === 11000) {
      return res.status(409).send({
        message: 'You have already joined this event'
      });
    }

    res.status(500).send({
      message: 'Failed to join event'
    });
  }
});

app.get('/joined-events/:email', async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
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
        joinedAt: joinedRecord?.joinedAt
      };
    });

    res.send(joinedEvents);

  } catch (err) {
    console.error(err);
    res.status(500).send({
      message: 'Failed to get joined events'
    });
  }
});


app.get('/my-events/:email', async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();

    const events = await eventsCollection
      .find({ organizerEmail: email })
      .toArray();

    res.send(events);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to get your events' });
  }
});

// Delete event
app.delete('/delete-event/:id', async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: 'Invalid event ID' });
    }

    const result = await eventsCollection.deleteOne({
      _id: new ObjectId(id)
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'Event not found' });
    }

    res.send({ message: 'Event deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Failed to delete event' });
  }
});


app.get('/', (req, res) => {
  res.send('Hello World!');
});

async function startServer() {
  await connectToMongoDB();

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer();
