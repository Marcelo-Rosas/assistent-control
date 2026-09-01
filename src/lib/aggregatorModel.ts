import * as tf from '@tensorflow/tfjs';
import { N_CLASSES, N_FEATURES } from '../types/academiaTrain';

export function createAggregatorModel(hidden1 = 16, hidden2 = 8): tf.Sequential {
  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: hidden1,
      activation: 'relu',
      inputShape: [N_FEATURES],
    }),
  );
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: hidden2, activation: 'relu' }));
  model.add(tf.layers.dense({ units: N_CLASSES, activation: 'softmax' }));
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

export type TrainProgress = {
  epoch: number;
  loss: number;
  acc: number;
  valLoss?: number;
  valAcc?: number;
};

export type EpochRecord = TrainProgress & { epoch: number };

export type TrainResult = {
  history: EpochRecord[];
};

export async function trainAggregatorModel(
  model: tf.Sequential,
  xs: Float32Array,
  ys: Float32Array,
  n: number,
  opts: {
    epochs?: number;
    batchSize?: number;
    validationSplit?: number;
    xsVal?: Float32Array;
    ysVal?: Float32Array;
    nVal?: number;
    onEpoch?: (p: TrainProgress) => void;
    fitCallbacks?: tf.CustomCallbackArgs['callbacks'];
  } = {},
): Promise<TrainResult> {
  const epochs = opts.epochs ?? 60;
  const batchSize = opts.batchSize ?? 32;
  const validationSplit = opts.validationSplit ?? 0.2;
  const history: EpochRecord[] = [];

  const xTensor = tf.tensor2d(xs, [n, N_FEATURES]);
  const yTensor = tf.tensor2d(ys, [n, N_CLASSES]);

  const useExplicitVal =
    opts.xsVal != null && opts.ysVal != null && opts.nVal != null && opts.nVal > 0;
  const xValTensor = useExplicitVal
    ? tf.tensor2d(opts.xsVal!, [opts.nVal!, N_FEATURES])
    : null;
  const yValTensor = useExplicitVal
    ? tf.tensor2d(opts.ysVal!, [opts.nVal!, N_CLASSES])
    : null;

  await model.fit(xTensor, yTensor, {
    epochs,
    batchSize,
    shuffle: true,
    ...(useExplicitVal
      ? { validationData: [xValTensor!, yValTensor!] }
      : { validationSplit }),
    callbacks: {
      ...opts.fitCallbacks,
      onEpochEnd: async (epoch, logs) => {
        const record: EpochRecord = {
          epoch,
          loss: logs?.loss ?? 0,
          acc: logs?.acc ?? 0,
          valLoss: logs?.val_loss,
          valAcc: logs?.val_acc,
        };
        history.push(record);
        opts.onEpoch?.(record);
        if (opts.fitCallbacks?.onEpochEnd) {
          await opts.fitCallbacks.onEpochEnd(epoch, logs);
        }
      },
    },
  });

  xTensor.dispose();
  yTensor.dispose();
  xValTensor?.dispose();
  yValTensor?.dispose();
  return { history };
}
