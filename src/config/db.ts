import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/three_way_match';

export let dbConnected = false;

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI);
    dbConnected = true;
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    dbConnected = false;
    console.log('Server will run without DB. Retry connection in background...');
    // Retry every 5 seconds
    setInterval(() => {
      if (!dbConnected) {
        mongoose.connect(MONGODB_URI)
          .then(() => { dbConnected = true; console.log('MongoDB connected (retry)'); })
          .catch(() => {});
      }
    }, 5000);
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  dbConnected = false;
  console.log('MongoDB disconnected');
}
