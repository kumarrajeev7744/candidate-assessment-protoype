import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  VIDEO_UPLOAD_STATUSES,
  WRITTEN_ANSWER_MAX_LENGTH,
  type VideoUploadStatus,
} from './constants.js';

/** Metadata for the S3 video object. The video file itself lives only in S3. */
export interface IVideoMetadata {
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: VideoUploadStatus;
  uploadedAt?: Date;
}

export interface IResponse {
  candidateId: Types.ObjectId;
  questionId: Types.ObjectId;
  writtenAnswer: string;
  video?: IVideoMetadata;
  createdAt: Date;
  updatedAt: Date;
}

const videoSchema = new Schema<IVideoMetadata>(
  {
    objectKey: { type: String, required: [true, 'Video object key is required'], trim: true },
    mimeType: {
      type: String,
      required: [true, 'Video MIME type is required'],
      match: [/^video\/[\w.+-]+(;.*)?$/, 'MIME type must be a video type'],
    },
    sizeBytes: { type: Number, required: true, min: [0, 'Video size cannot be negative'] },
    uploadStatus: { type: String, enum: VIDEO_UPLOAD_STATUSES, default: 'Pending', required: true },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const responseSchema = new Schema<IResponse>(
  {
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: 'Candidate',
      required: [true, 'Candidate is required'],
    },
    questionId: {
      type: Schema.Types.ObjectId,
      ref: 'Question',
      required: [true, 'Question is required'],
    },
    writtenAnswer: {
      type: String,
      default: '',
      maxlength: [
        WRITTEN_ANSWER_MAX_LENGTH,
        `Written answer cannot exceed ${WRITTEN_ANSWER_MAX_LENGTH} characters`,
      ],
    },
    video: { type: videoSchema, required: false },
  },
  { timestamps: true },
);

// One response per candidate per question (also serves lookups by candidateId).
responseSchema.index({ candidateId: 1, questionId: 1 }, { unique: true });

export const Response = model<IResponse>('Response', responseSchema);
export type ResponseDocument = HydratedDocument<IResponse>;
