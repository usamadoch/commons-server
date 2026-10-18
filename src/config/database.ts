import mongoose from 'mongoose';
import config from './index.js';

export const connectDB = async (): Promise<void> => {
    try {
        const isStaging = process.env.APP_ENV === 'staging' || config.env === 'staging';
        if (isStaging && config.mongodb.uri.includes('commons_prod')) {
            throw new Error('FATAL CONFIGURATION ERROR: Staging service cannot connect to production database "commons_prod". Please configure MONGODB_URI for "commons_staging".');
        }

        const conn = await mongoose.connect(config.mongodb.uri);
        console.log(`MongoDB Connected: ${conn.connection.host} (DB: ${conn.connection.name})`);
    } catch (error) {
        if (error instanceof Error) {
            console.error(`MongoDB Connection Error: ${error.message}`);
        }
        process.exit(1);
    }
};

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
    console.error(`MongoDB error: ${err}`);
});

export default mongoose;
