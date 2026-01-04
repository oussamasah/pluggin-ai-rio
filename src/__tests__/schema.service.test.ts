import { schemaService } from '../services/schema.service';

describe('SchemaService', () => {
  test('should find direct hopping path', () => {
    const path = schemaService.findHoppingPath('companies', 'employees');

    expect(path).toBeDefined();
    expect(path?.from).toBe('companies');
    expect(path?.to).toBe('employees');
    expect(path?.via).toBe('companyId');
  });

  test('should return null for non-existent path', () => {
    const path = schemaService.findHoppingPath('nonexistent1', 'nonexistent2');
    expect(path).toBeNull();
  });

  test('should get searchable fields', () => {
    const fields = schemaService.getSearchableFields('companies');
    
    expect(fields).toContain('name');
    expect(fields).toContain('industry');
    expect(fields.length).toBeGreaterThan(0);
  });

  test('should identify collections with embeddings', () => {
    expect(schemaService.hasEmbedding('companies')).toBe(true);
    expect(schemaService.hasEmbedding('sessions')).toBe(false);
  });
});