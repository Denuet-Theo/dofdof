import { NextRequest, NextResponse } from 'next/server';

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const limit = searchParams.get('limit') || '20';

  if (!query || query.length < 2) {
    return NextResponse.json({ total: 0, data: [] });
  }

  // Normalize query: remove accents and lowercase for slug search
  const normalizedQuery = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, '')
    .trim();

  try {
    const url = new URL('https://api.dofusdb.fr/items');
    url.searchParams.set('slug.fr[$regex]', normalizedQuery);
    url.searchParams.set('$limit', limit);
    url.searchParams.set('$select[]', 'id');
    // Need multiple $select — use append
    ['name', 'level', 'img', 'typeId', 'type', 'slug', 'hasRecipe', 'iconId'].forEach(
      (field) => url.searchParams.append('$select[]', field)
    );

    const res = await fetch(url.toString(), {
      next: { revalidate: 300 }, // Cache for 5 minutes
    });

    if (!res.ok) {
      throw new Error(`DofusDB API error: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('DofusDB items fetch error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la recherche DofusDB' },
      { status: 500 }
    );
  }
};
