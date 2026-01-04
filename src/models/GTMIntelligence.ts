// src/models/GTMIntelligence.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IGTMIntelligence extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId: Types.ObjectId;
  companyId: Types.ObjectId;
  
  // Text-based analysis fields
  overview: string;
  userId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

const GTMIntelligenceSchema = new Schema<IGTMIntelligence>(
  {
    sessionId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Session', 
      required: true, 
      index: true 
    },
    icpModelId: { 
      type: Schema.Types.ObjectId, 
      ref: 'ICPModel', 
      required: true, 
      index: true 
    },
    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Company', 
      required: true, 
      index: true 
    },
    
    // Text-based analysis fields
    overview: { 
      type: String, 
      required: true 
    },
    embedding: {
      type: [Number],
      default: undefined,
      index: 'vector', // For MongoDB Atlas vector search
      select: false, // Don't include in queries by default
    },
    embeddingText: { type: String, select: false },
    embeddingVersion: { select: false,type: String, default: 'v1' },
    embeddingGeneratedAt: { select: false,type: Date },
    userId: { type: String, required: true, select: false,index: true },
    // ✅ NEW: Search optimization
    searchKeywords: {
      type: [String],
      default: [],
      index: true,select: false
    },
    semanticSummary: { type: String },
  },
  { 
    timestamps: true,
    collection: 'gtm_intelligence',
    toJSON: { 
      virtuals: true,
      transform: (doc: any, ret: any) => {
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

// Indexes for efficient querying
GTMIntelligenceSchema.index({ sessionId: 1, companyId: 1 }, { unique: true });
GTMIntelligenceSchema.index({ icpModelId: 1, icpFitScore: -1 });
GTMIntelligenceSchema.index({ refreshStatus: 1 });
GTMIntelligenceSchema.index({ lastRefreshed: -1 });

// Text search index for analysis fields
GTMIntelligenceSchema.index({
  overview: 'text',
  'searchKeywords': 'text',
});
GTMIntelligenceSchema.index({ 'embeddingGeneratedAt': -1 });

// Virtual for easy access to company data
GTMIntelligenceSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for easy access to ICP model
GTMIntelligenceSchema.virtual('icpModel', {
  ref: 'ICPModel',
  localField: 'icpModelId',
  foreignField: '_id',
  justOne: true
});

export const GTMIntelligence = mongoose.model<IGTMIntelligence>('GTMIntelligence', GTMIntelligenceSchema);