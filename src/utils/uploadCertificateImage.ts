// ============================================================
// uploadCertificateImage.ts — Uploaders for the "certificates"
// public storage bucket. Single + multi-file APIs.
// ============================================================

import { supabase } from '@/integrations/supabase/client';

async function uploadOne(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'bin';
  const path = `cert-${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('certificates')
    .upload(path, file, { upsert: false });

  if (error) {
    console.error('Certificate upload failed:', file.name, error);
    return null;
  }
  const { data } = supabase.storage.from('certificates').getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export async function uploadCertificateImage(file: File): Promise<string | null> {
  return uploadOne(file);
}

export async function uploadCertificateFiles(files: File[]): Promise<string[]> {
  const results = await Promise.all(files.map((f) => uploadOne(f)));
  return results.filter((url): url is string => !!url);
}
