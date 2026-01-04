// src/models/Employee.ts
import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEmployee extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  
  // ==================== METADATA SECTION ====================
  coresignalEmployeeId: number; // CoreSignal's numeric ID
  parentId?: number;
  historicalIds?: number[];
  isDeleted: boolean;
  isParent: boolean;
  publicProfileId?: number;
  
  // Timestamps from CoreSignal
  coresignalCreatedAt?: Date;
  coresignalUpdatedAt?: Date;
  coresignalCheckedAt?: Date;
  coresignalChangedAt?: Date;
  experienceChangeLastIdentifiedAt?: Date;
  
  // ==================== IDENTIFIERS & URLs ====================
  linkedinUrl?: string;
  linkedinShorthandNames?: string[];
  
  // ==================== EMPLOYEE INFORMATION ====================
  userId: string;
  fullName: string;
  firstName: string;
  firstNameInitial?: string;
  lastName: string;
  lastNameInitial?: string;
  middleName?: string;
  middleNameInitial?: string;
  headline?: string;
  summary?: string;
  pictureUrl?: string;
  locationCountry?: string;
  locationCity?: string;
  locationState?: string;
  locationFull?: string;
  locationCountryIso2?: string;
  locationCountryIso3?: string;
  locationRegions?: string[];
  connectionsCount?: number;
  followersCount?: number;
  interests?: string[];
  
  // ==================== PROFESSIONAL CONTACT ====================
  primaryProfessionalEmail?: string;
  primaryProfessionalEmailStatus?: 'verified' | 'matched_email' | 'matched_pattern' | 'guessed_common_pattern';
  professionalEmails?: Array<{
    professional_email: string;
    professional_email_status: string;
    order_of_priority: number;
  }>;
  
  // ==================== EXPERIENCE & WORKPLACE ====================
  isWorking: boolean;
  services?: string;
  
  // Active Experience
  activeExperienceTitle?: string;
  activeExperienceCompanyId?: number;
  activeExperienceDescription?: string;
  activeExperienceDepartment?: string;
  activeExperienceManagementLevel?: string;
  isDecisionMaker: boolean;
  
  // Skills
  inferredSkills?: string[];
  historicalSkills?: string[];
  
  // Experience Duration
  totalExperienceDurationMonths?: number;
  experienceDepartmentBreakdown?: Array<{
    department: string;
    total_experience_duration_months: number;
  }>;
  experienceManagementBreakdown?: Array<{
    management_level: string;
    total_experience_duration_months: number;
  }>;
  
  // Experience History
  experienceHistory?: Array<{
    active_experience: number; // 0 or 1
    position_title: string;
    department?: string;
    management_level?: string;
    location?: string;
    date_from: string;
    date_from_year: number;
    date_from_month: number;
    date_to: string;
    date_to_year: number;
    date_to_month: number;
    duration_months: number;
    description?: string;
    company_logo_url?: string;
  }>;
  
  // Recent Experience Changes
  experienceRecentlyStarted?: Array<{
    company_id: string;
    company_name: string;
    company_url: string;
    company_shorthand_name: string;
    date_from: string;
    date_to: string;
    title: string;
    identification_date: string;
  }>;
  
  experienceRecentlyClosed?: Array<{
    company_id: string;
    company_name: string;
    company_url: string;
    company_shorthand_name: string;
    date_from: string;
    date_to: string;
    title: string;
    identification_date: string;
  }>;
  
  // ==================== WORKPLACE DETAILS ====================
  // For current company (active experience)
  company?: {
    company_id: number;
    company_name: string;
    company_type?: string;
    company_founded_year?: string;
    company_size_range?: string;
    company_employees_count?: number;
    company_categories_and_keywords?: string[];
    company_employees_count_change_yearly_percentage?: number;
    company_industry?: string;
    company_last_updated_at?: string;
    company_is_b2b?: number;
    order_in_profile?: number;
    
    // Social Media
    company_followers_count?: number;
    company_website?: string;
    company_facebook_url?: string[];
    company_twitter_url?: string[];
    company_linkedin_url?: string;
    
    // Financials
    company_annual_revenue_source_1?: number;
    company_annual_revenue_source_5?: number;
    company_annual_revenue_currency_source_1?: string;
    company_annual_revenue_currency_source_5?: string;
    company_last_funding_round_date?: string;
    company_last_funding_round_amount_raised?: number;
    company_stock_ticker?: Array<{
      exchange: string;
      ticker: string;
    }>;
    
    // Locations
    company_hq_full_address?: string;
    company_hq_country?: string;
    company_hq_regions?: string[];
    company_hq_country_iso2?: string;
    company_hq_country_iso3?: string;
    company_hq_city?: string;
    company_hq_state?: string;
    company_hq_street?: string;
    company_hq_zipcode?: string;
  };
  
  // ==================== EDUCATION ====================
  lastGraduationDate?: string;
  educationDegrees?: string[];
  educationHistory?: Array<{
    degree?: string;
    description?: string;
    institution_url?: string;
    institution_logo_url?: string;
    institution_name?: string;
    institution_full_address?: string;
    institution_country_iso2?: string;
    institution_country_iso3?: string;
    institution_regions?: string[];
    institution_city?: string;
    institution_state?: string;
    institution_street?: string;
    institution_zipcode?: string;
    date_from_year?: number;
    date_to_year?: number;
    activities_and_societies?: string;
    order_in_profile?: number;
  }>;
  
  // ==================== SALARY DATA ====================
  projectedBaseSalary?: {
    p25?: number;
    median?: number;
    p75?: number;
    period?: string;
    currency?: string;
    updated_at?: string;
  };
  
  projectedAdditionalSalary?: Array<{
    type: string;
    p25?: number;
    median?: number;
    p75?: number;
  }>;
  
  projectedTotalSalary?: {
    p25?: number;
    median?: number;
    p75?: number;
    period?: string;
    currency?: string;
    updated_at?: string;
  };
  
  // ==================== PROFILE FIELD CHANGES ====================
  profileRootFieldChangesSummary?: Array<{
    field_name: string;
    change_type: string;
    last_changed_at: string;
  }>;
  
  profileCollectionFieldChangesSummary?: Array<{
    field_name: string;
    last_changed_at: string;
  }>;
  
  // ==================== RECOMMENDATIONS ====================
  recommendationsCount?: number;
  recommendations?: Array<{
    recommendation: string;
    referee_full_name: string;
    referee_url: string;
    order_in_profile: number;
  }>;
  
  // ==================== ACTIVITIES ====================
  activities?: Array<{
    activity_url: string;
    title: string;
    action: string;
    order_in_profile: number;
  }>;
  
  // ==================== AWARDS ====================
  awards?: Array<{
    title: string;
    issuer: string;
    description: string;
    date: string;
    date_year: number;
    date_month: number;
    order_in_profile: number;
  }>;
  
  // ==================== COURSES ====================
  courses?: Array<{
    organizer: string;
    title: string;
    order_in_profile: number;
  }>;
  
  // ==================== CERTIFICATIONS ====================
  certifications?: Array<{
    title: string;
    issuer: string;
    issuer_url?: string;
    credential_id?: string;
    certificate_url?: string;
    certificate_logo_url?: string;
    date_from: string;
    date_from_year: number;
    date_from_month: number;
    date_to?: string;
    date_to_year?: number;
    date_to_month?: number;
    order_in_profile: number;
  }>;
  
  // ==================== LANGUAGES ====================
  languages?: Array<{
    language: string;
    proficiency?: string;
    order_in_profile: number;
  }>;
  
  // ==================== PATENTS ====================
  patentsCount?: number;
  patentsTopics?: string[];
  patents?: Array<{
    title: string;
    status?: string;
    description?: string;
    patent_url?: string;
    date: string;
    date_year: number;
    date_month: number;
    patent_number?: string;
    order_in_profile: number;
  }>;
  
  // ==================== PUBLICATIONS ====================
  publicationsCount?: number;
  publicationsTopics?: string[];
  publications?: Array<{
    title: string;
    description?: string;
    publication_url?: string;
    publisher_names?: string[];
    date: string;
    date_year: number;
    date_month: number;
    order_in_profile: number;
  }>;
  
  // ==================== PROJECTS ====================
  projectsCount?: number;
  projectsTopics?: string[];
  projects?: Array<{
    name: string;
    description?: string;
    project_url?: string;
    date_from: string;
    date_from_year: number;
    date_from_month: number;
    date_to: string;
    date_to_year: number;
    date_to_month: number;
    order_in_profile: number;
  }>;
  
  // ==================== ORGANIZATIONS ====================
  organizations?: Array<{
    organization_name: string;
    position?: string;
    description?: string;
    date_from: string;
    date_from_year: number;
    date_from_month: number;
    date_to: string;
    date_to_year: number;
    date_to_month: number;
    order_in_profile: number;
  }>;
  
  // ==================== CUSTOM FIELDS ====================
  githubUrl?: string;
  githubUsername?: string;
  
  // ==================== DATABASE TIMESTAMPS ====================
  createdAt: Date;
  updatedAt: Date;
  embedding: {
    type: [Number],
    default: undefined,
    index: 'vector',
    select: false,
  },
  searchKeywords: {
    type: [String],
    default: [],
    index: true,
  },
  semanticSummary: { type: String },
  embeddingText: { type: String, select: false },
  embeddingVersion: { type: String, default: 'v1' },
  embeddingGeneratedAt: { type: Date },
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Company', 
      required: true, 
      index: true 
    },
    
    // ==================== METADATA SECTION ====================
    coresignalEmployeeId: { 
      type: Number, 
      required: true,
      index: true 
    },
    parentId: { 
      type: Number, 
      default: null 
    },
    historicalIds: [{ 
      type: Number 
    }],
    isDeleted: { 
      type: Boolean, 
      default: false 
    },
    isParent: { 
      type: Boolean, 
      default: false 
    },
    publicProfileId: { 
      type: Number, 
      default: null 
    },
    coresignalCreatedAt: { 
      type: Date, 
      default: null 
    },
    coresignalUpdatedAt: { 
      type: Date, 
      default: null 
    },
    coresignalCheckedAt: { 
      type: Date, 
      default: null 
    },
    coresignalChangedAt: { 
      type: Date, 
      default: null 
    },
    experienceChangeLastIdentifiedAt: { 
      type: Date, 
      default: null 
    },
    
    // ==================== IDENTIFIERS & URLs ====================
    linkedinUrl: { 
      type: String, 
      default: null 
    },
    linkedinShorthandNames: [{ 
      type: String 
    }],
    
    // ==================== EMPLOYEE INFORMATION ====================
    fullName: { 
      type: String, 
      required: true,
      trim: true 
    },
    firstName: { 
      type: String, 
      required: true,
      trim: true 
    },
    firstNameInitial: { 
      type: String, 
      default: null 
    },
    lastName: { 
      type: String, 
      required: true,
      trim: true 
    },
    lastNameInitial: { 
      type: String, 
      default: null 
    },
    middleName: { 
      type: String, 
      default: null,
      trim: true 
    },
    middleNameInitial: { 
      type: String, 
      default: null 
    },
    headline: { 
      type: String, 
      default: null 
    },
    summary: { 
      type: String, 
      default: null 
    },
    pictureUrl: { 
      type: String, 
      default: null 
    },
    locationCountry: { 
      type: String, 
      default: null 
    },
    locationCity: { 
      type: String, 
      default: null 
    },
    locationState: { 
      type: String, 
      default: null 
    },
    locationFull: { 
      type: String, 
      default: null 
    },
    locationCountryIso2: { 
      type: String, 
      default: null,
      uppercase: true,
      maxlength: 2 
    },
    locationCountryIso3: { 
      type: String, 
      default: null,
      uppercase: true,
      maxlength: 3 
    },
    locationRegions: [{ 
      type: String 
    }],
    connectionsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    followersCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    interests: [{ 
      type: String 
    }],
    
    // ==================== PROFESSIONAL CONTACT ====================
    primaryProfessionalEmail: { 
      type: String, 
      default: null,
      lowercase: true,
      trim: true 
    },
    primaryProfessionalEmailStatus: { 
      type: String, 
      enum: ['verified', 'matched_email', 'matched_pattern', 'guessed_common_pattern'],
      default: null 
    },
    professionalEmails: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== EXPERIENCE & WORKPLACE ====================
    isWorking: { 
      type: Boolean, 
      default: false 
    },
    services: { 
      type: String, 
      default: null 
    },
    activeExperienceTitle: { 
      type: String, 
      default: null 
    },
    activeExperienceCompanyId: { 
      type: Number, 
      default: null 
    },
    activeExperienceDescription: { 
      type: String, 
      default: null 
    },
    activeExperienceDepartment: { 
      type: String, 
      default: null 
    },
    activeExperienceManagementLevel: { 
      type: String, 
      default: null 
    },
    isDecisionMaker: { 
      type: Boolean, 
      default: false 
    },
    inferredSkills: [{ 
      type: String 
    }],
    historicalSkills: [{ 
      type: String 
    }],
    totalExperienceDurationMonths: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    experienceDepartmentBreakdown: [{ 
      type: Schema.Types.Mixed 
    }],
    experienceManagementBreakdown: [{ 
      type: Schema.Types.Mixed 
    }],
    experienceHistory: [{ 
      type: Schema.Types.Mixed 
    }],
    experienceRecentlyStarted: [{ 
      type: Schema.Types.Mixed 
    }],
    experienceRecentlyClosed: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== WORKPLACE DETAILS ====================
    company: { 
      type: Schema.Types.Mixed,
      default: null 
    },
    
    // ==================== EDUCATION ====================
    lastGraduationDate: { 
      type: String, 
      default: null 
    },
    educationDegrees: [{ 
      type: String 
    }],
    educationHistory: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== SALARY DATA ====================
    projectedBaseSalary: { 
      type: Schema.Types.Mixed,
      default: null 
    },
    projectedAdditionalSalary: [{ 
      type: Schema.Types.Mixed 
    }],
    projectedTotalSalary: { 
      type: Schema.Types.Mixed,
      default: null 
    },
    
    // ==================== PROFILE FIELD CHANGES ====================
    profileRootFieldChangesSummary: [{ 
      type: Schema.Types.Mixed 
    }],
    profileCollectionFieldChangesSummary: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== RECOMMENDATIONS ====================
    recommendationsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    recommendations: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== ACTIVITIES ====================
    activities: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== AWARDS ====================
    awards: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== COURSES ====================
    courses: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== CERTIFICATIONS ====================
    certifications: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== LANGUAGES ====================
    languages: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== PATENTS ====================
    patentsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    patentsTopics: [{ 
      type: String 
    }],
    patents: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== PUBLICATIONS ====================
    publicationsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    publicationsTopics: [{ 
      type: String 
    }],
    publications: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== PROJECTS ====================
    projectsCount: { 
      type: Number, 
      default: 0,
      min: 0 
    },
    projectsTopics: [{ 
      type: String 
    }],
    projects: [{ 
      type: Schema.Types.Mixed 
    }],
    
    // ==================== ORGANIZATIONS ====================
    organizations: [{ 
      type: Schema.Types.Mixed 
    }],
    userId: { type: String, required: true, index: true },
    // ==================== CUSTOM FIELDS ====================
    githubUrl: { 
      type: String, 
      default: null 
    },
    githubUsername: { 
      type: String, 
      default: null 
    },
    embedding: {
      type: [Number],
      default: undefined,
      index: 'vector',
      select: false,
    },
    embeddingText: { type: String, select: false },
    embeddingVersion: { select: false,type: String, default: 'v1' },
    embeddingGeneratedAt: { select: false,type: Date },
    
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
    collection: 'employees',
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

// Compound index to ensure unique employees per company
EmployeeSchema.index({ 
  companyId: 1, 
  coresignalEmployeeId: 1 
}, { 
  unique: true,
  name: 'company_employee_unique' 
});

// Additional indexes for better query performance
EmployeeSchema.index({ isDecisionMaker: 1 });
EmployeeSchema.index({ isWorking: 1 });
EmployeeSchema.index({ isParent: 1 });
EmployeeSchema.index({ activeExperienceCompanyId: 1 });
EmployeeSchema.index({ 'company.company_id': 1 });
EmployeeSchema.index({ 'company.company_name': 1 });
EmployeeSchema.index({ fullName: 'text', headline: 'text', summary: 'text' , activeExperienceTitle: 'text',  'searchKeywords': 'text'});
EmployeeSchema.index({ 'embeddingGeneratedAt': -1 });

// Text search index for skills and interests
EmployeeSchema.index({ 
  inferredSkills: 'text', 
  interests: 'text', 
  'company.company_categories_and_keywords': 'text' 
});

export const Employee = mongoose.model<IEmployee>('Employee', EmployeeSchema);