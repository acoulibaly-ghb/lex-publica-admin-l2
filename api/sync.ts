
export const config = {
    runtime: 'edge',
};

// Note: Cette route nécessite l'installation de @vercel/kv et la configuration des variables d'environnement
// Si non configuré, elle renvoie une erreur explicative pour le prof.

export default async function handler(req: Request) {
    // Support des formats : Vercel KV, Upstash Marketplace, ou préfixe personnalisé 'STORAGE'
    const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN;
    const kvEnabled = kvUrl && kvToken;
    const prefix = process.env.COURSE_ID ? `${process.env.COURSE_ID}_` : '';

    // GET: Récupérer tous les profils (pour le dashboard prof) ou la config
    if (req.method === 'GET') {
        if (!kvEnabled) return new Response(JSON.stringify({ error: 'DATABASE_NOT_CONFIGURED', message: 'Veuillez configurer Vercel KV ou Upstash Redis.' }), { status: 500 });

        const { searchParams } = new URL(req.url);
        const type = searchParams.get('type') || 'profiles';
        const key = type === 'config' ? `${prefix}global_config` : `${prefix}global_profiles`;

        try {
            const result = await fetch(`${kvUrl}/get/${key}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            }).then(res => res.json()).then(data => JSON.parse(data.result || (type === 'config' ? '{}' : '[]')));

            return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify(type === 'config' ? {} : []), { status: 200 });
        }
    }

    // POST: Sauvegarder ou mettre à jour un profil ou la config
    if (req.method === 'POST') {
        if (!kvEnabled) return new Response(JSON.stringify({ error: 'DB_DISABLED' }), { status: 500 });

        try {
            const payload = await req.json();

            if (payload.type === 'config') {
                // Sauvegarde simple de la config globale
                await fetch(`${kvUrl}/set/${prefix}global_config`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${kvToken}` },
                    body: JSON.stringify(payload.data)
                });
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            // Sinon on traite comme un profil (historique)
            const { profile } = payload;
            if (!profile) return new Response(JSON.stringify({ error: 'MISSING_PROFILE' }), { status: 400 });

            const profilesKey = `${prefix}global_profiles`;

            // On récupère la liste actuelle
            const currentProfiles = await fetch(`${kvUrl}/get/${profilesKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            }).then(res => res.json()).then(data => JSON.parse(data.result || '[]'));

            // On fusionne (mise à jour ou ajout)
            const index = currentProfiles.findIndex((p: any) => p.id === profile.id);
            if (index !== -1) {
                currentProfiles[index] = profile;
            } else {
                currentProfiles.push(profile);
            }

            // On sauvegarde
            await fetch(`${kvUrl}/set/${profilesKey}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${kvToken}` },
                body: JSON.stringify(currentProfiles)
            });

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
            return new Response(JSON.stringify({ error: 'SYNC_ERROR' }), { status: 500 });
        }
    }

    return new Response('Method Not Allowed', { status: 405 });
}
