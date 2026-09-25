const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('MONGODB_URI is not configured. Account creation through the IVR is unavailable.');
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('Connected to MongoDB successfully.');
    return true;
  } catch (error) {
    console.warn('MongoDB connection failed (' + (error.name || 'Error') + '). Account creation through the IVR is unavailable until the database is connected.');
    return false;
  }
};

module.exports = connectDB;
