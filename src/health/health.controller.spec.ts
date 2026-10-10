import { ServiceUnavailableException } from '@nestjs/common';
import { Connection, ConnectionStates } from 'mongoose';
import { HealthController } from './health.controller';

const controllerWith = (readyState: ConnectionStates) =>
  new HealthController({ readyState } as Connection);

describe('HealthController', () => {
  it('reports ok when the database is connected', () => {
    expect(controllerWith(ConnectionStates.connected).check()).toEqual({
      status: 'ok',
      db: 'up',
    });
  });

  it.each([ConnectionStates.disconnected, ConnectionStates.connecting])(
    'throws 503 when the connection state is %s',
    (state) => {
      expect(() => controllerWith(state).check()).toThrow(
        ServiceUnavailableException,
      );
    },
  );
});
