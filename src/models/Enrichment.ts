
// src/models/Enrichment.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEnrichment extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  sessionId: Types.ObjectId;
  icpModelId?: Types.ObjectId;
  data: Record<string, any>;
  source: string;
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

const EnrichmentSchema = new Schema<IEnrichment>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    icpModelId: { type: Schema.Types.ObjectId, ref: 'ICPModel', index: true },
    data: { type: Schema.Types.Mixed, required: true },
    source: { type: String, required: true },
    embedding: {
      type: [Number],
      default: undefined,
      index: 'vector', // For MongoDB Atlas vector search
      select: false, // Don't include in queries by default
    },
    embeddingText: { type: String, select: false },
    embeddingVersion: {select: false, type: String, default: 'v1' },
    embeddingGeneratedAt: {select: false, type: Date },
    userId: {select: false, type: String, required: true, index: true },
    // ✅ NEW: Search optimization
    searchKeywords: {
      type: [String],
      default: [],select: false,
      index: true,
    },
    semanticSummary: { select: false,type: String },
  },
  { 
    timestamps: true,
    collection: 'enrichments',
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

// Indexes
EnrichmentSchema.index({ companyId: 1, source: 1 });
EnrichmentSchema.index({ sessionId: 1 });
EnrichmentSchema.index({ 'searchKeywords': 'text' });
EnrichmentSchema.index({ 'embeddingGeneratedAt': -1 });

export const Enrichment = mongoose.model<IEnrichment>('Enrichment', EnrichmentSchema);
