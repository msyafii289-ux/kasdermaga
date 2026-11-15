-- Jalankan sekali di Supabase SQL Editor.
-- Memastikan warga tidak bisa mengirim pendaftaran ketika admin menutup pendaftaran.
DROP POLICY IF EXISTS "Warga mengirim pendaftaran"
ON public.tambangan_registrations;

CREATE POLICY "Warga mengirim pendaftaran"
ON public.tambangan_registrations
FOR INSERT TO anon, authenticated
WITH CHECK (
    payment_status = 'menunggu_verifikasi'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND EXISTS (
        SELECT 1
        FROM public.registration_settings
        WHERE id = 1
          AND is_active = true
          AND payment_amount = tambangan_registrations.payment_amount
    )
);
