module shapes
  use iso_fortran_env, only: real64, int32
  implicit none
  private
  public :: shape_t, circle_t, make_circle, wp
  integer, parameter :: wp = real64

  type, abstract :: shape_t
   contains
     procedure(area_i), deferred :: area
     procedure :: describe
  end type shape_t

  abstract interface
     pure function area_i(self) result(a)
       import :: shape_t, wp
       class(shape_t), intent(in) :: self
       real(wp) :: a
     end function area_i
  end interface

  type, extends(shape_t) :: circle_t
     real(wp) :: r = 1.0_wp
   contains
     procedure :: area => circle_area
  end type circle_t

contains

  pure function circle_area(self) result(a)
    class(circle_t), intent(in) :: self
    real(wp) :: a
    a = 3.14159265358979_wp * self%r * self%r
  end function circle_area

  subroutine describe(self, label)
    class(shape_t), intent(in) :: self
    character(len=*), intent(in) :: label
    print '(a,a,f12.6)', trim(label), " area=", self%area()
  end subroutine describe

  function make_circle(r) result(c)
    real(wp), intent(in) :: r
    type(circle_t), allocatable :: c
    allocate(c)
    c%r = r
  end function make_circle
end module shapes

program main
  use shapes
  implicit none
  class(shape_t), allocatable :: s
  type(circle_t), allocatable :: c
  real(wp), allocatable :: mat(:,:), vec(:), res(:)
  integer :: i, n
  character(len=:), allocatable :: msg

  c = make_circle(2.0_wp)
  allocate(s, source=c)
  call s%describe("circle")

  n = 4
  allocate(mat(n,n), vec(n))
  do i = 1, n
     vec(i) = real(i, wp)
     mat(:,i) = real(i, wp)
  end do
  res = matmul(mat, vec)
  print '(a,4f10.3)', " matmul=", res
  print '(a,f12.6)', " norm2=", norm2(res)

  msg = "allocatable deferred-length string"
  print '(a,i0,a,a)', " len=", len(msg), " val=", msg

  ! associate + do concurrent
  associate (t => sum(vec))
    print '(a,f8.3)', " sum=", t
  end associate
  do concurrent (i = 1:n)
     vec(i) = vec(i) * 2.0_wp
  end do
  print '(a,4f8.3)', " doubled=", vec
end program main
