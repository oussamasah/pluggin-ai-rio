// src/models/ICPModel.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IICPModel extends Document {
  _id: Types.ObjectId;
  name: string;
  isPrimary: boolean;
  userId: string;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ICPModelSchema = new Schema<IICPModel>(
  {
    name: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
    userId: { type: String, required: true, index: true },
    config: { type: Schema.Types.Mixed, required: true }
    
  },
  { 
    timestamps: true,
    collection: 'icp_models'
  }
);

// Index for finding primary model per user
ICPModelSchema.index({ userId: 1, isPrimary: 1 });

export const ICPModel = mongoose.model<IICPModel>('ICPModel', ICPModelSchema);
