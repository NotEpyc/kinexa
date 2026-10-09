import axios from 'axios';

const api = axios.create({
  baseURL: '/api/backend',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Patient {
  id: string;
  therapist_id: string;
  name: string;
  age?: number;
  notes?: string;
  created_at: string;
}

export interface Plan {
  id: string;
  patient_id: string;
  exercise: string;
  active: boolean;
  created_at: string;
}

export interface Parameter {
  id: string;
  plan_id: string;
  metric: string;
  side: 'left' | 'right' | 'either';
  phase: 'at_bottom' | 'at_peak' | 'whole_rep';
  min_value?: number;
  max_value?: number;
  unit: string;
  tolerance?: number;
  effective_from: string;
  effective_to?: string;
  version: number;
}

export interface RepResult {
  rep: number;
  status: 'correct' | 'incorrect' | 'not_assessable';
  start_s: number;
  bottom_s: number;
  end_s: number;
  measurements: Record<string, number>;
  ml?: { label: string; confidence: number; top_factors: string[] };
  issues: string[];
}

export interface AnalyzeResponse {
  analysis_id: string;
  exercise: string;
  model_version: string;
  total_reps: number;
  correct_reps: number;
  incorrect_reps: number;
  score: number;
  reps: RepResult[];
  warnings: string[];
}

export const patientsApi = {
  list: (therapistId?: string) => api.get<Patient[]>('/patients', { params: { therapist_id: therapistId } }),
  get: (id: string) => api.get<Patient>(`/patients/${id}`),
  create: (data: { therapist_id: string; name: string; age?: number; notes?: string }) => api.post<Patient>('/patients', data),
  update: (id: string, data: Partial<Patient>) => api.put<Patient>(`/patients/${id}`, data),
};

export const plansApi = {
  list: (patientId: string) => api.get<{ id: string; patient_id: string; exercise: string; active: boolean; created_at: string }[]>(`/patients/${patientId}/plans`),
  create: (patientId: string, data: { exercise: string; active: boolean }) => api.post(`/patients/${patientId}/plans`, { ...data, patient_id: patientId }),
};

export const parametersApi = {
  list: (patientId: string, planId: string) => api.get(`/patients/${patientId}/plans/${planId}/parameters`),
  create: (patientId: string, planId: string, data: Omit<Parameter, 'id'>) => api.post(`/patients/${patientId}/plans/${planId}/parameters`, data),
  update: (patientId: string, planId: string, paramId: string, data: Partial<Parameter>) => api.put(`/patients/${patientId}/plans/${planId}/parameters/${paramId}`, data),
};

export const analyzeApi = {
  upload: (video: File, patientId: string, exercise: string = 'squat') => {
    const formData = new FormData();
    formData.append('video', video);
    formData.append('patient_id', patientId);
    formData.append('exercise', exercise);
    return api.post<{
      analysis_id: string;
      exercise: string;
      model_version: string;
      total_reps: number;
      correct_reps: number;
      incorrect_reps: number;
      score: number;
      reps: Array<{
        rep: number;
        status: string;
        start_s: number;
        bottom_s: number;
        end_s: number;
        measurements: Record<string, number>;
        ml?: { label: string; confidence: number; top_factors: string[] };
        issues: string[];
      }>;
      warnings: string[];
    }>('/analyze', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  get: (id: string) => api.get(`/analyses/${id}`),
  history: (patientId: string) => api.get(`/patients/${patientId}/analyses`),
};

export const healthApi = {
  check: () => api.get('/health'),
};