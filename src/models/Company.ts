// src/models/Company.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

// Import related interfaces
import { ISession } from './Session';
import { IICPModel } from './ICPModel';
import { IGTMIntelligence } from './GTMIntelligence';

export interface ICompany extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId | ISession; // Can be ObjectId or populated ISession
  icpModelId: Types.ObjectId | IICPModel; // Can be ObjectId or populated IICPModel
  name: string;
  domain?: string;
  website?: string;
  logoUrl?: string;
  description?: string;
  foundedYear?: number;
  city?: string;
  userId?: string;
  country?: string;
  countryCode?: string;
  contactEmail?: string;
  contactPhone?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  crunchbaseUrl?: string;
  industry: string[];
  targetMarket?: string;
  ownershipType?: string;
  employeeCount?: number;
  annualRevenue?: number;
  annualRevenueCurrency?: string;
  fundingStage?: string;
  technologies: string[];
  intentSignals: Record<string, any>;
  relationships: Record<string, any>;
  scoringMetrics: Record<string, any>;
  totalFunding?: number;
  exaId?: string;
  embedding: {
    type: [Number],
    default: undefined,
    index: 'vector', // For MongoDB Atlas vector search
    select: false, // Don't include in queries by default
  },
  embeddingText: { type: String, select: false },
  embeddingVersion: { type: String, default: 'v1' },
  embeddingGeneratedAt: { type: Date },
  
  // ✅ NEW: Search optimization
  searchKeywords: {
    type: [String],
    default: [],
    index: true,
  },
  semanticSummary: { type: String },
  // Virtual field
  gtmIntelligence?: IGTMIntelligence;
  
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompany>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    icpModelId: { type: Schema.Types.ObjectId, ref: 'ICPModel', required: true, index: true },
    name: { type: String, required: true },
    domain: String,
    website: String,
    logoUrl: String,
    description: String,
    foundedYear: Number,
    city: String,
    country: String,
    countryCode: String,
    contactEmail: String,
    contactPhone: String,
    linkedinUrl: String,
    twitterUrl: String,
    facebookUrl: String,
    instagramUrl: String,
    crunchbaseUrl: String,
    industry: { type: [String], default: [] },
    targetMarket: String,
    ownershipType: String,
    employeeCount: Number,
    annualRevenue: Number,
    annualRevenueCurrency: String,
    fundingStage: String,
    technologies: { type: [String], default: [] },
    intentSignals: { type: Schema.Types.Mixed, default: {} },
    relationships: { type: Schema.Types.Mixed, default: {} },
    scoringMetrics: { type: Schema.Types.Mixed, default: {} },
    totalFunding: Number,
    exaId: String,
    userId: { type: String, required: true, index: true },
    embedding: {
      type: [Number],
      default: undefined,
      index: 'vector', // For MongoDB Atlas vector search
      select: false, // Don't include in queries by default
    },
    embeddingText: { type: String, select: false },
    embeddingVersion: { select: false,type: String, default: 'v1' },
    embeddingGeneratedAt: {select: false, type: Date },
    
    // ✅ NEW: Search optimization
    searchKeywords: {
      type: [String],
      default: [],
      index: true,select: false
    },
    semanticSummary: {select: false, type: String },
  },
  { 
    timestamps: true,
    collection: 'companies',
    toJSON: { 
      virtuals: true,
      transform: (doc, ret) => {
        // Force removal of large fields during JSON conversion
        delete ret.embedding;
        delete ret.searchKeywords;
        delete ret.semanticSummary;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// Virtual for GTM Intelligence (one-to-one)
CompanySchema.virtual('gtmIntelligence', {
  ref: 'GTMIntelligence',
  localField: '_id',
  foreignField: 'companyId',
  justOne: true
});
CompanySchema.virtual('employees', {
    ref: 'Employee',
    localField: '_id',
    foreignField: 'companyId'
  });
// Indexes
CompanySchema.index({ sessionId: 1, createdAt: -1 });
CompanySchema.index({ icpModelId: 1 });
CompanySchema.index({ exaId: 1 });
CompanySchema.index({ name: 'text', description: 'text', 'searchKeywords': 'text' });
CompanySchema.index({ 'embeddingGeneratedAt': -1 });

export const Company = mongoose.model<ICompany>('Company', CompanySchema);