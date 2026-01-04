// src/models/GTMIntelligence.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface GTMPersonaIntelligence extends Document {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId: Types.ObjectId;
  companyId: Types.ObjectId;
  employeeId: Types.ObjectId;
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

const GTMPersonaIntelligenceSchema= new Schema<GTMPersonaIntelligence>(
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
    employeeId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Employee', 
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
    embeddingVersion: {select: false, type: String, default: 'v1' },
    embeddingGeneratedAt: { select: false,type: Date },
    userId: { type: String, required: true, index: true },
    // ✅ NEW: Search optimization
    searchKeywords: {
      type: [String],
      default: [],
      index: true,
      select: false
    },
    semanticSummary: { type: String },
},
  { 
    timestamps: true,
    collection: 'gtm_persona_intelligence',
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

// Indexes for efficient querying
GTMPersonaIntelligenceSchema.index({ sessionId: 1, employeeId: 1, companyId: 1 }, { unique: true });
GTMPersonaIntelligenceSchema.index({ 'embeddingGeneratedAt': -1 });


// Text search index for analysis fields
GTMPersonaIntelligenceSchema.index({
  overview: 'text',
  'searchKeywords': 'text',

});

// Virtual for easy access to company data
GTMPersonaIntelligenceSchema.virtual('company', {
  ref: 'Company',
  localField: 'companyId',
  foreignField: '_id',
  justOne: true
});

// Virtual for easy access to ICP model
GTMPersonaIntelligenceSchema.virtual('icpModel', {
  ref: 'ICPModel',
  localField: 'icpModelId',
  foreignField: '_id',
  justOne: true
});

export const GTMPersonaIntelligence = mongoose.model<GTMPersonaIntelligence>('GTMPersonaIntelligence', GTMPersonaIntelligenceSchema);