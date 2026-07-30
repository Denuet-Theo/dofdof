import { NextRequest, NextResponse } from 'next/server';

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';
  const limit = searchParams.get('limit') || '20';
  const skip = searchParams.get('skip') || '0';
  const typeId = searchParams.get('typeId');
  const hasQuery = query.length >= 2;

  // A typeId lets callers browse a whole item category (e.g. all "Pain" items)
  // without a name to search for, so only bail out when neither is usable.
  if (!hasQuery && !typeId) {
    return NextResponse.json({ total: 0, data: [] });
  }

  try {
    const url = new URL('https://api.dofusdb.fr/items');
    url.searchParams.set('$limit', limit);
    url.searchParams.set('$skip', skip);
    if (typeId) {
      const typeIds = typeId.split(',').map((t) => t.trim()).filter(Boolean);
      if (typeIds.length > 1) {
        typeIds.forEach((t) => url.searchParams.append('typeId[$in][]', t));
      } else if (typeIds.length === 1) {
        url.searchParams.set('typeId', typeIds[0]);
      }
    }
    if (hasQuery) {
      // Normalize query: remove accents and lowercase for slug search
      const normalizedQuery = query
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, '')
        .trim();
      // Each word must appear somewhere in the slug, in any order, so combining a free-text
      // term with a gauge name (e.g. "potion foudroyeur") narrows instead of overriding.
      const words = normalizedQuery.split(/\s+/).filter(Boolean);
      const regex = words.map((word) => `(?=.*${word})`).join('');
      url.searchParams.set('slug.fr[$regex]', regex);
    }
    url.searchParams.set('$select[]', 'id');
    // Need multiple $select — use append
    [
      'name',
      'level',
      'img',
      'typeId',
      'type',
      'slug',
      'hasRecipe',
      'iconId',
      'description',
      'effects',
    ].forEach((field) => url.searchParams.append('$select[]', field));

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
