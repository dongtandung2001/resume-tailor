export type View = 'upload' | 'editor';

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface SavedResume {
  id: number;
  filename: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeHeader {
  name: string;
  phone: string;
  email: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
}

export interface EducationEntry {
  id: string;
  institution: string;
  location: string;
  degree: string;
  startDate: string;
  endDate: string;
  gpa: string;
  bullets: string[];
}

export interface ExperienceEntry {
  id: string;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface ProjectEntry {
  id: string;
  name: string;
  location: string;
  technologies: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface ResumeData {
  header: ResumeHeader;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  projects: ProjectEntry[];
  skills: string;
}
