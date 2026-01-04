import { hybridRetriever } from '../retrieval/hybrid-retriever';
import { searchService } from '../services/search.service';

jest.mock('../services/search.service');

describe('HybridRetriever', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should infer collections from entities', async () => {
    const mockSearch = jest.spyOn(searchService, 'search').mockResolvedValue({
      documents: [{ _id: '123', name: 'Test Company' }],
      total: 1,
      method: 'hybrid',
      confidence: 0.8,
    });

    const result = await hybridRetriever.retrieve('test query', {
      userId: 'user123',
      entities: [
        { type: 'company', value: 'Test', confidence: 0.9 },
      ],
      limit: 10,
    });

    expect(result).toHaveLength(2); // companies + gtm_intelligence
    expect(mockSearch).toHaveBeenCalled();
  });

  test('should flatten nested objects', () => {
    const nested = {
      name: 'Test',
      data: {
        nested: {
          value: 123,
        },
      },
      array: [{ item: 1 }, { item: 2 }],
    };

    const flattened = hybridRetriever['flattenObject'](nested);

    expect(flattened['name']).toBe('Test');
    expect(flattened['data.nested.value']).toBe(123);
    expect(flattened['array[0].item']).toBe(1);
  });
});