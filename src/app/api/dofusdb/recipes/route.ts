import { NextRequest, NextResponse } from 'next/server';

export const GET = async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams;
  const limit = searchParams.get('limit') || '50';
  const skip = searchParams.get('skip') || '0';
  const jobId = searchParams.get('jobId');
  const minLevel = searchParams.get('minLevel');
  const maxLevel = searchParams.get('maxLevel');

  try {
    const url = new URL('https://api.dofusdb.fr/recipes');
    url.searchParams.set('$limit', limit);
    url.searchParams.set('$skip', skip);

    const resultIds = searchParams.get('resultIds');

    if (jobId) {
      url.searchParams.set('jobId', jobId);
    }
    if (minLevel) {
      url.searchParams.set('resultLevel[$gte]', minLevel);
    }
    if (maxLevel) {
      url.searchParams.set('resultLevel[$lte]', maxLevel);
    }
    if (resultIds) {
      // DofusDB expects an array-like syntax or comma-separated list for $in
      // e.g. resultId[$in]=1,2,3 or resultId[$in][]=1&resultId[$in][]=2
      // Let's use the bracket array syntax as it's safer
      const ids = resultIds.split(',');
      ids.forEach((id) => {
        url.searchParams.append('resultId[$in][]', id.trim());
      });
    }

    const res = await fetch(url.toString(), {
      next: { revalidate: 600 }, // Cache for 10 minutes
    });

    if (!res.ok) {
      throw new Error(`DofusDB API error: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('DofusDB recipes fetch error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la récupération des recettes' },
      { status: 500 }
    );
  }
};
