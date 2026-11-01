import express from 'express';
import { MongoClient } from 'mongodb';
import 'dotenv/config';
import cors from 'cors';


const app = express();
const port = 5000;

app.use(cors({
    origin: 'http://localhost:3000'
}));

app.use(express.json());
const client = new MongoClient(process.env.MONGODB_URL);
let eventsCollection;
async function connectToMongoDB() {
  try {
    await client.connect();
    const database = client.db('event-management');
    eventsCollection = database.collection('events');
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
