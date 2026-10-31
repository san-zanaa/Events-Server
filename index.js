import express from 'express';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const app = express();
const port = 5000;

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
  }
}

app.post('/event-management', async (req, res) => {
  try {
    const event = req.body;
    const result = await eventsCollection.insertOne(event);
    res.send({
      message: 'Event added successfully!',
      insertedId: result.insertedId
    });

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Something went wrong' });
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
