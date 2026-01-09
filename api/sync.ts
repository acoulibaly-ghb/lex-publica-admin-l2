// On garde l'Edge Runtime ici, c'est parfait pour la rapidité de la base de données
export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    // Support des formats : Vercel KV, Upstash Marketplace, ou préfixe personnalisé 'STORAGE'
    const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN;
    const kvEnabled = kvUrl && kvToken;
    
    // Sécurité : On ajoute un préfixe par cours si configuré, pour éviter les mélanges
    const prefix = process.env.COURSE_ID ? `${process.env.COURSE_ID}_` : '';

    // 1. GET: Récupération
    if (req.method === 'GET') {
        if (!kvEnabled) {
            // On renvoie un tableau vide si pas de DB, pour ne pas casser l'appli
            console.warn("⚠️ Base de données non configurée (GET)");
            return new Response(JSON.stringify([]), { 
                status: 200, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }

        const { searchParams } = new URL(req.url);
        const type = searchParams.get('type') || 'profiles';
        const key = type === 'config' ? `${prefix}global_config` : `${prefix}global_profiles`;

        try {
            const response = await fetch(`${kvUrl}/get/${key}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            
            const data = await response.json();
            // Redis renvoie les données sous forme de string dans "result", il faut le parser
            const result = JSON.parse(data.result || (type === 'config' ? '{}' : '[]'));

            return new Response(JSON.stringify(result), { 
                status: 200,
                headers: { 'Content-Type': 'application/json' } 
            });
        } catch (e) {
            console.error("Erreur lecture DB:", e);
            // Fallback : on renvoie vide en cas d'erreur pour que l'appli continue de marcher (mode local)
            return new Response(JSON.stringify(type === 'config' ? {} : []), { status: 200 });
        }
    }

    // 2. POST: Sauvegarde
    if (req.method === 'POST') {
        if (!kvEnabled) {
            return new Response(JSON.stringify({ error: 'DB_DISABLED', message: 'Aucune base de données connectée' }), { status: 500 });
        }

        try {
            const payload = await req.json();

            // Cas A : Sauvegarde de la Config Globale (Dashboard Prof)
            if (payload.type === 'config') {
                await fetch(`${kvUrl}/set/${prefix}global_config`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${kvToken}` },
                    body: JSON.stringify(payload.data)
                });
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }

            // Cas B : Sauvegarde d'un profil étudiant
            const { profile } = payload;
            if (!profile) return new Response(JSON.stringify({ error: 'MISSING_PROFILE' }), { status: 400 });

            const profilesKey = `${prefix}global_profiles`;

            // a. On récupère la liste actuelle
            const currentData = await fetch(`${kvUrl}/get/${profilesKey}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            }).then(res => res.json());
            
            const currentProfiles = JSON.parse(currentData.result || '[]');

            // b. On met à jour ou on ajoute
            const index = currentProfiles.findIndex((p: any) => p.id === profile.id);
            if (index !== -1) {
                currentProfiles[index] = profile;
            } else {
                currentProfiles.push(profile);
            }

            // c. On sauvegarde la liste mise à jour
            await fetch(`${kvUrl}/set/${profilesKey}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${kvToken}` },
                body: JSON.stringify(currentProfiles)
            });

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });

        } catch (e) {
            console.error("Erreur écriture DB:", e);
            return new Response(JSON.stringify({ error: 'SYNC_ERROR' }), { status: 500 });
        }
    }

    return new Response('Method Not Allowed', { status: 405 });
}