export interface DashboardSubmission {
  id: string;
  submissionId: string;
  widgetId: string;
  widgetName: string;
  payload: Record<string, unknown>;
  geoCountry: string | null;
  geoCity: string | null;
  geoProvider: string | null;
  origin: string | null;
  createdAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DashboardSubmissionsListResponse {
  data: DashboardSubmission[];
  pagination: PaginationMeta;
}

export interface WidgetSubmissionCount {
  widgetId: string;
  widgetName: string;
  count: number;
}

export interface DashboardStats {
  totalSubmissions: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
  byWidget: WidgetSubmissionCount[];
}

export interface DashboardJobItem {
  id: string;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
}

export interface DashboardJobsListResponse {
  data: DashboardJobItem[];
  pagination: PaginationMeta;
}

export interface DashboardWidgetItem {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
  allowedOrigins: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DashboardWidgetsListResponse {
  data: DashboardWidgetItem[];
}

export interface ListSubmissionsFilter {
  widgetId?: string;
  from?: Date;
  to?: Date;
  sort?: 'created_at_desc' | 'created_at_asc' | 'desc' | 'asc';
  page: number;
  limit: number;
}
