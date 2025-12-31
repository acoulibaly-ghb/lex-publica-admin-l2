// Route API Edge haute performance
export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { messages, systemInstruction, courseContent } = await req.json();
        const apiKey = process.env.API_KEY || process.env.VITE_API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'ClÃ© API non configurÃ©e' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Utilisation du modÃ¨le 2.0 Flash (confirmÃ© dans votre liste de modÃ¨les)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        // On limite l'historique aux 10 derniers messages pour Ã©viter les requÃªtes trop lourdes (Limit 4MB)
        const recentMessages = messages.slice(-10);

        const contents = recentMessages.map((m: any) => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: [
                { text: m.text },
                ...(m.file ? [{ inlineData: { mimeType: m.file.mimeType, data: m.file.data } }] : [])
            ]
        }));

        const body = {
            contents,
            systemInstruction: {
                parts: [{ text: `${systemInstruction}\n\nCONTEXTE DU COURS :\n${courseContent}` }]
            },
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (!response.ok) {
            return new Response(JSON.stringify({ error: data.error?.message || 'Erreur API Google' }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "DÃ©solÃ©e, je n'ai pas pu gÃ©nÃ©rer de rÃ©ponse.";

        return new Response(JSON.stringify({ text }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: any) {
        console.error(error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

