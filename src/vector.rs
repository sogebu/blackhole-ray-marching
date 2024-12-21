use core::ops::{Add, AddAssign, Div, DivAssign, Mul, MulAssign, Neg, Sub, SubAssign};
use rand::{
    distr::{Distribution, StandardUniform},
    Rng,
};

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct Vector(f64, f64, f64);

macro_rules! impl_bin_op {
    ($trait_name:ident, $method_name:ident) => {
        impl $trait_name for Vector {
            type Output = Vector;
            fn $method_name(self, rhs: Vector) -> Vector {
                Vector(
                    self.0.$method_name(rhs.0),
                    self.1.$method_name(rhs.1),
                    self.2.$method_name(rhs.2),
                )
            }
        }
        impl $trait_name<f64> for Vector {
            type Output = Vector;
            fn $method_name(self, rhs: f64) -> Vector {
                Vector(
                    self.0.$method_name(rhs),
                    self.1.$method_name(rhs),
                    self.2.$method_name(rhs),
                )
            }
        }
    };
}

impl_bin_op!(Add, add);
impl_bin_op!(Sub, sub);
impl_bin_op!(Mul, mul);
impl_bin_op!(Div, div);

macro_rules! impl_assign {
    ($trait_name:ident, $method_name:ident) => {
        impl $trait_name for Vector {
            fn $method_name(&mut self, rhs: Vector) {
                (self.0).$method_name(rhs.0);
                (self.1).$method_name(rhs.1);
                (self.2).$method_name(rhs.2);
            }
        }
        impl $trait_name<f64> for Vector {
            fn $method_name(&mut self, rhs: f64) {
                (self.0).$method_name(rhs);
                (self.1).$method_name(rhs);
                (self.2).$method_name(rhs);
            }
        }
    };
}

impl_assign!(AddAssign, add_assign);
impl_assign!(SubAssign, sub_assign);
impl_assign!(MulAssign, mul_assign);
impl_assign!(DivAssign, div_assign);

impl Neg for Vector {
    type Output = Vector;
    fn neg(self) -> Vector {
        Vector(-self.0, -self.1, -self.2)
    }
}

impl Vector {
    pub const fn new(x: f64, y: f64, z: f64) -> Vector {
        Vector(x, y, z)
    }

    pub const fn x(&self) -> f64 {
        self.0
    }

    pub const fn y(&self) -> f64 {
        self.1
    }

    pub const fn z(&self) -> f64 {
        self.2
    }

    pub fn norm_squared(&self) -> f64 {
        self.0 * self.0 + self.1 * self.1 + self.2 * self.2
    }

    pub fn norm(&self) -> f64 {
        self.norm_squared().sqrt()
    }

    pub fn normalized(&self) -> Vector {
        *self / self.norm()
    }

    pub fn powf(&self, n: f64) -> Vector {
        Vector(self.0.powf(n), self.1.powf(n), self.2.powf(n))
    }

    pub fn dot(&self, other: &Vector) -> f64 {
        self.0 * other.0 + self.1 * other.1 + self.2 * other.2
    }

    /// Cross production
    ///
    /// ## Example
    ///
    /// ```rust
    /// # use blackhole_ray_marching::Vector;
    /// let u = Vector::new(1.0, 2.0, 3.0);
    /// let v = Vector::new(4.0, 5.0, 6.0);
    /// assert_eq!(u.cross(&v), Vector::new(-3.0, 6.0, -3.0));
    /// ```
    pub fn cross(&self, other: &Vector) -> Vector {
        Vector(
            self.1 * other.2 - other.1 * self.2,
            self.2 * other.0 - other.2 * self.0,
            self.0 * other.1 - other.0 * self.1,
        )
    }

    pub fn random_in_unit_sphere<R: Rng>(rng: &mut R) -> Vector {
        loop {
            let v = rng.random::<Vector>() * 2.0 - Vector(1.0, 1.0, 1.0);
            if v.norm_squared() <= 1.0 {
                break v;
            }
        }
    }
}

impl Distribution<Vector> for StandardUniform {
    fn sample<R: Rng + ?Sized>(&self, rng: &mut R) -> Vector {
        Vector(rng.random(), rng.random(), rng.random())
    }
}

#[macro_export]
macro_rules! vec3 {
    ($x:expr, $y:expr, $z:expr) => {
        Vector::new($x, $y, $z)
    };
    ($v:expr) => {
        Vector::new($v, $v, $v)
    };
}

#[derive(Debug, Clone)]
pub struct Ray {
    pub origin: Vector,
    pub direction: Vector,
}

impl Ray {
    pub fn new(origin: Vector, direction: Vector) -> Ray {
        Ray { origin, direction }
    }
}
