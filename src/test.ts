import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
// New public API uses createLogger; parseConnectionString lives in connection module
import { createLogger, parseConnectionString } from '../dist/index.js';

describe('OpenPull Node.js Library', () => {
  describe('parseConnectionString', () => {
    it('should parse valid connection string with appender role', () => {
      const result = parseConnectionString('openpull://appender:secret123@session.localhost:3000/');
      assert.equal(result.host, 'session.localhost:3000');
      assert.equal(result.role, 'appender');
      assert.equal(result.key, 'secret123');
    });

    it('should parse valid connection string with reader role', () => {
      const result = parseConnectionString('openpull://reader:key456@test.example.com:443/');
      assert.equal(result.role, 'reader');
      assert.equal(result.key, 'key456');
      assert.equal(result.host, 'test.example.com:443');
    });

    it('should throw error for invalid protocol', () => {
      assert.throws(
        () => parseConnectionString('http://appender:key@host:3000/'),
        /Invalid protocol/
      );
    });

    it('should throw error for invalid role', () => {
      assert.throws(
        () => parseConnectionString('openpull://invalid:key@host:3000/'),
        /Invalid role/
      );
    });
  });

  describe('logger', () => {
    it('should create logger with default fields', () => {
      const log = createLogger({
        defaultFields: {
          service: 'test',
          version: '1.0.0',
        },
      });

      assert.equal(typeof log.info, 'function');
      assert.equal(typeof log.error, 'function');
      assert.equal(typeof log.debug, 'function');
      assert.equal(typeof log.warning, 'function');
      assert.equal(typeof log.startTrace, 'function');
    });

    it('should create trace with proper methods', () => {
      const log = createLogger({
        defaultFields: {
          service: 'test',
        },
      });

      const trace = log.startTrace({ operation: 'test' });
      assert.equal(typeof trace.span, 'function');
      assert.equal(typeof trace.finish, 'function');
    });

    it('should not throw when logging without connection', () => {
      const log = createLogger({
        defaultFields: {
          service: 'test',
        },
      });

      // These should not throw (will fall back to console)
      assert.doesNotThrow(() => log.info('Test info message'));
      assert.doesNotThrow(() => log.error('Test error message', { code: 'E001' }));

      const trace = log.startTrace({ operation: 'test' });
      assert.doesNotThrow(() => trace.span('Test span'));
      assert.doesNotThrow(() => trace.finish());
    });
  });

  describe('TypeScript types', () => {
    it('should import types successfully', async () => {
      // Import types to ensure they exist and are properly exported
      await assert.doesNotReject(
        async () => await import('../dist/types.js'),
        'Types module should import without error'
      );
    });
  });
});
