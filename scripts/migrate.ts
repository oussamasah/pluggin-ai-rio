import mongoose from 'mongoose';
import { config } from '../src/core/config';
import { logger } from '../src/core/logger';

async function migrate() {
  logger.info('Starting migration...');

  await mongoose.connect(config.mongodb.uri, {
    dbName: config.mongodb.dbName,
  });

  // Create indexes
  const db = mongoose.connection.db;
  
  const collections = [
    'companies',
    'employees',
    'enrichments',
    'gtm_intelligence',
    'gtm_persona_intelligence',
    'icp_models',
    'sessions',
  ];

  for (const collectionName of collections) {
    logger.info(`Creating indexes for ${collectionName}`);
    
    const collection = db.collection(collectionName);
    
    // Text search indexes
    await collection.createIndex({ 
      '$**': 'text' 
    }, { 
      background: true 
    });

    logger.info(`✓ ${collectionName} indexes created`);
  }

  logger.info('Migration complete');
  await mongoose.disconnect();
}

migrate().catch(console.error);