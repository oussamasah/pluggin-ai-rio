// src/models/Session.ts - Updated version
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IRefinementState {
  stage: 'initial' | 'proposed' | 'refining' | 'confirmed' | 'searching';
  currentQuery?: string;
  proposalHistory?: Array<{
    query: string;
    timestamp: Date;
    userFeedback?: string;
  }>;
}

export interface ISearchStatus {
  stage: 'idle' | 'error' | 'refining-query' | 'awaiting-clarification' | 'searching' | 'analyzing' | 'filtering' | 'complete' | 'enriching' | 'scoring';
  message: string;
  progress: number;
  currentStep: number;
  totalSteps: number;
  substeps: any[];
}

export interface ISession extends Document {
  _id: Types.ObjectId;
  name: string;
  query: string[];
  resultsCount: number;
  userId: string;
  icpModelId?: Types.ObjectId;
  searchStatus: ISearchStatus;
  
  // 🔄 New fields for refinement
  refinementState: IRefinementState;
  currentProposal?: string;
  
  createdAt: Date;
  updatedAt: Date;
}

// Define the nested schema for refinementState
const RefinementStateSchema = new Schema({
  stage: { 
    type: String, 
    enum: ['initial', 'proposed', 'refining', 'confirmed', 'searching'],
    default: 'initial' 
  },
  currentQuery: { type: String, default: '' },
  proposalHistory: {
    type: [{
      query: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
      userFeedback: { type: String }
    }],
    default: []
  }
}, { _id: false });

// Define the nested schema for searchStatus (existing)
const SearchStatusSchema = new Schema({
  stage: { 
    type: String, 
    enum: ['idle', 'error', 'refining-query', 'awaiting-clarification', 'searching', 'analyzing', 'filtering', 'complete', 'enriching', 'scoring'],
    default: 'idle' 
  },
  message: { type: String, default: 'Session created' },
  progress: { type: Number, default: 0 },
  currentStep: { type: Number, default: 0 },
  totalSteps: { type: Number, default: 4 },
  substeps: { type: [Schema.Types.Mixed], default: [] }
}, { _id: false });

const SessionSchema = new Schema<ISession>(
  {
    name: { type: String, required: true },
    query: { type: [String], default: [] },
    resultsCount: { type: Number, default: 0 },
    userId: { type: String, required: true, index: true },
    icpModelId: { type: Schema.Types.ObjectId, ref: 'ICPModel', index: true },
    searchStatus: {
      type: SearchStatusSchema,
      default: () => ({
        stage: 'idle',
        message: 'Session created',
        progress: 0,
        currentStep: 0,
        totalSteps: 4,
        substeps: []
      })
    },
    
    // 🔄 New fields for refinement
    refinementState: {
      type: RefinementStateSchema,
      default: () => ({
        stage: 'initial',
        currentQuery: '',
        proposalHistory: []
      })
    },
    currentProposal: { type: String, default: '' }
  },
  { 
    timestamps: true,
    collection: 'sessions'
  }
);

// Indexes
SessionSchema.index({ userId: 1, createdAt: -1 });
SessionSchema.index({ icpModelId: 1 });

export const Session = mongoose.model<ISession>('Session', SessionSchema);